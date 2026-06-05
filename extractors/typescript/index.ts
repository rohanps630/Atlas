/**
 * TypeScript/JavaScript extractor (thin, per ADR 0005).
 *
 * Reads a repo with ts-morph and emits the normalized ExtractorOutput from
 * docs/schema.md §2. The core never sees source — only this JSON.
 *
 * Phase 1 scope (minimal): one `module` node per source file; `function` nodes
 * for function declarations, arrow/function-expression variables, and class
 * methods; `import` edges (module -> module) and `call` edges (fn -> fn).
 * Only references that resolve to an in-repo node become edges — library and
 * unknown calls are dropped here (external nodes are a Phase 2 concept).
 *
 * Endpoints (consumes/exposes) are intentionally NOT extracted yet — Phase 2.
 */

import * as path from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type SourceFile,
  type CallExpression,
} from "ts-morph";
import {
  SCHEMA_VERSION,
  type AtlasEdge,
  type AtlasNode,
  type ConsumedEndpoint,
  type ExposedEndpoint,
  type ExtractorOutput,
} from "../../core/schema.js";
import { newStats, type ResolutionStats } from "../shared/resolve.js";

export interface ExtractOptions {
  /** Absolute path to the repo root. */
  repoPath: string;
  /** Stable id used to namespace node ids (e.g. "ghost-daddy"). */
  repoId: string;
}

export function extractRepo(opts: ExtractOptions, stats?: ResolutionStats): ExtractorOutput {
  const repoRoot = path.resolve(opts.repoPath);
  const st = stats ?? newStats();
  const project = loadProject(repoRoot);

  const sourceFiles = project
    .getSourceFiles()
    .filter((sf) => isInRepo(sf.getFilePath(), repoRoot));

  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];

  // Map from a ts-morph declaration node to the atlas node id we created for it.
  // Used to resolve call/import targets back to in-repo nodes.
  const declToId = new Map<Node, string>();
  const fileToModuleId = new Map<string, string>();
  const nodeIds = new Set<string>();

  const rel = (sf: SourceFile) => toPosix(path.relative(repoRoot, sf.getFilePath()));

  // Pass 1: create module + function nodes, recording declaration -> id.
  for (const sf of sourceFiles) {
    const relFile = rel(sf);
    const moduleId = `${opts.repoId}:${relFile}`;
    fileToModuleId.set(sf.getFilePath(), moduleId);
    if (!nodeIds.has(moduleId)) {
      nodes.push({
        id: moduleId,
        kind: "module",
        name: path.basename(relFile),
        file: relFile,
        line: 1,
      });
      nodeIds.add(moduleId);
    }

    for (const { decl, name, line } of collectFunctions(sf)) {
      const id = uniqueId(`${opts.repoId}:${relFile}#${name}`, nodeIds);
      nodeIds.add(id);
      nodes.push({ id, kind: "function", name, file: relFile, line });
      declToId.set(decl, id);
    }
  }

  // Pass 2: edges + endpoints. Imports (module -> module), calls (fn -> fn),
  // HTTP client calls (consumes), and route registrations (exposes).
  const consumes: ConsumedEndpoint[] = [];
  const exposes: ExposedEndpoint[] = [];
  for (const sf of sourceFiles) {
    const fromModule = fileToModuleId.get(sf.getFilePath())!;

    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue; // external package or unresolved
      const toModule = fileToModuleId.get(target.getFilePath());
      if (!toModule || toModule === fromModule) continue;
      edges.push({
        from: fromModule,
        to: toModule,
        kind: "import",
        line: imp.getStartLineNumber(),
      });
    }

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const fromId = enclosingId(call, declToId) ?? fromModule;

      const toId = resolveCallTarget(call, declToId);
      // Call-resolution coverage (ADR 0013): ts-morph is type-aware, so an
      // unresolved call that still declares inside the repo is internal-unmapped;
      // anything resolving to node_modules / lib types is an expected external.
      st.total++;
      if (toId && toId !== fromId) {
        st.resolved++;
        edges.push({
          from: fromId,
          to: toId,
          kind: "call",
          line: call.getStartLineNumber(),
        });
      } else if (toId === fromId) {
        st.skippedSelf++;
      } else if (targetsInRepo(call, repoRoot)) {
        st.skippedAmbiguous++; // internal-unresolved (mirrors the Go/native bucket)
      } else {
        st.unresolved++; // external / library / runtime
      }

      const consume = detectConsume(call, fromId);
      if (consume) consumes.push(consume);

      const expose = detectExpose(call, fromId, declToId);
      if (expose) exposes.push(expose);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    repo: opts.repoId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    endpoints: { consumes, exposes },
  };
}

const HTTP_VERBS = new Set(["get", "post", "put", "delete", "patch"]);
// An object that "looks like" an HTTP client (heuristic — the map is a hint).
const CLIENT_RE = /api|http|client|request|axios|fetch/i;
// An object that "looks like" a server/router registering routes.
const SERVER_RE = /app|router|server|express|route/i;
const PATH_KEYS = new Set(["slug", "url", "path", "route", "endpoint"]);

/**
 * Detect an HTTP client call and record it as a consumed endpoint.
 *
 * Handles `fetch(url, { method })`, `axios.get(url)`, `client.post(url, body)`,
 * and the object-arg style `this.api.post({ slug, body })`. The path is taken
 * verbatim from the path argument: a real route (starts with `/` or `http`) is
 * `resolved: true`; anything else (e.g. `resolveSlug("auth","register")`) is a
 * symbolic, unresolved path that the linker will leave as an `external` node.
 */
function detectConsume(
  call: CallExpression,
  fromId: string,
): ConsumedEndpoint | undefined {
  const callee = call.getExpression();
  const args = call.getArguments();
  let method: string | undefined;

  if (Node.isIdentifier(callee) && callee.getText() === "fetch") {
    method = fetchMethod(args[1]) ?? "GET";
  } else if (Node.isPropertyAccessExpression(callee)) {
    const verb = callee.getName().toLowerCase();
    if (HTTP_VERBS.has(verb) && CLIENT_RE.test(callee.getExpression().getText())) {
      method = verb.toUpperCase();
    }
  }
  if (!method) return undefined;

  const pathArg = pathArgument(args[0]);
  if (!pathArg) return undefined;

  const value = pathText(pathArg);
  if (!value) return undefined;

  // A symbolic path that is a bare identifier (e.g. `slug`, `url`) carries no
  // endpoint information — it's typically a client-wrapper forwarding its arg.
  // Drop it; the meaningful call site is the caller that supplied a real value.
  const isRoute = /^(\/|https?:\/\/)/.test(value);
  if (!isRoute && /^[A-Za-z_$][\w$]*$/.test(value)) return undefined;

  return { method, path: value, from: fromId, line: call.getStartLineNumber() };
}

/** The expression holding the path: an object's slug/url/path prop, or arg[0]. */
function pathArgument(arg: Node | undefined): Node | undefined {
  if (!arg) return undefined;
  if (Node.isObjectLiteralExpression(arg)) {
    for (const prop of arg.getProperties()) {
      if (Node.isPropertyAssignment(prop) && PATH_KEYS.has(prop.getName())) {
        return prop.getInitializer();
      }
    }
    return undefined;
  }
  return arg;
}

/** A string literal's value, or the trimmed source text of any other expr. */
function pathText(expr: Node): string {
  if (Node.isStringLiteral(expr)) return expr.getLiteralValue();
  const t = expr.getText().trim();
  // Unwrap a single quoted/template string, but leave compound expressions
  // (e.g. `a + b`) intact so concatenations aren't mangled.
  for (const q of ["`", "'", '"']) {
    if (t.length >= 2 && t.startsWith(q) && t.endsWith(q)) return t.slice(1, -1);
  }
  return t;
}

/** Pull `method: "POST"` out of a fetch options object literal. */
function fetchMethod(opts: Node | undefined): string | undefined {
  if (!opts || !Node.isObjectLiteralExpression(opts)) return undefined;
  for (const prop of opts.getProperties()) {
    if (Node.isPropertyAssignment(prop) && prop.getName() === "method") {
      const init = prop.getInitializer();
      if (init && Node.isStringLiteral(init)) return init.getLiteralValue().toUpperCase();
    }
  }
  return undefined;
}

/**
 * Detect a route registration and record it as an exposed endpoint.
 *
 * Handles the Express family: `app.get("/path", handler)`,
 * `router.post("/path", mw, handler)`. Requires a server/router-like object, a
 * string-literal path, and a handler argument. The handler resolves to an
 * in-repo function node when it's a named reference, else to the enclosing
 * function/module where the route is registered.
 */
function detectExpose(
  call: CallExpression,
  fromId: string,
  declToId: Map<Node, string>,
): ExposedEndpoint | undefined {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;

  const verb = callee.getName().toLowerCase();
  if (!HTTP_VERBS.has(verb)) return undefined;

  const objText = callee.getExpression().getText();
  if (!SERVER_RE.test(objText) || CLIENT_RE.test(objText)) return undefined;

  const args = call.getArguments();
  const first = args[0];
  if (!first || !Node.isStringLiteral(first)) return undefined; // need a literal route
  const path = first.getLiteralValue();
  if (!path.startsWith("/")) return undefined;

  // The handler is the last function/identifier argument (after path + middleware).
  let handler = fromId;
  for (let i = args.length - 1; i >= 1; i--) {
    const a = args[i]!;
    if (Node.isIdentifier(a)) {
      const resolved = resolveIdentifierTarget(a, declToId);
      if (resolved) {
        handler = resolved;
        break;
      }
    } else if (Node.isArrowFunction(a) || Node.isFunctionExpression(a)) {
      // inline handler — attribute to where the route is registered (fromId)
      break;
    }
  }

  return { method: verb.toUpperCase(), path, handler, line: call.getStartLineNumber() };
}

/** Resolve an identifier (e.g. a handler reference) to an in-repo node id. */
function resolveIdentifierTarget(
  id: Node,
  declToId: Map<Node, string>,
): string | undefined {
  let symbol;
  try {
    symbol = id.getSymbol();
    if (symbol) symbol = symbol.getAliasedSymbol() ?? symbol;
  } catch {
    return undefined;
  }
  if (!symbol) return undefined;
  for (const decl of symbol.getDeclarations()) {
    const direct = declToId.get(decl);
    if (direct) return direct;
    let parent: Node | undefined = decl.getParent();
    while (parent) {
      const pid = declToId.get(parent);
      if (pid) return pid;
      parent = parent.getParent();
    }
  }
  return undefined;
}

/** Load a ts-morph project from the repo's tsconfig if present, else by glob. */
function loadProject(repoRoot: string): Project {
  const tsconfig = path.join(repoRoot, "tsconfig.json");
  let project: Project;
  try {
    project = new Project({
      tsConfigFilePath: tsconfig,
      skipAddingFilesFromTsConfig: false,
    });
  } catch {
    project = new Project({ compilerOptions: { allowJs: true } });
  }
  if (project.getSourceFiles().length === 0) {
    project.addSourceFilesAtPaths([
      `${repoRoot}/**/*.{ts,tsx,js,jsx}`,
      `!${repoRoot}/**/node_modules/**`,
      `!${repoRoot}/**/dist/**`,
    ]);
  }
  return project;
}

interface FoundFunction {
  decl: Node;
  name: string;
  line: number;
}

/** Collect function-like declarations we turn into `function` nodes. */
function collectFunctions(sf: SourceFile): FoundFunction[] {
  const found: FoundFunction[] = [];

  for (const fn of sf.getFunctions()) {
    const name = fn.getName() ?? (fn.isDefaultExport() ? "default" : undefined);
    if (name) found.push({ decl: fn, name, line: fn.getStartLineNumber() });
  }

  for (const v of sf.getVariableDeclarations()) {
    const init = v.getInitializer();
    if (
      init &&
      (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
    ) {
      found.push({ decl: v, name: v.getName(), line: v.getStartLineNumber() });
    }
  }

  for (const cls of sf.getClasses()) {
    const className = cls.getName() ?? "anonymous";
    for (const m of cls.getMethods()) {
      found.push({
        decl: m,
        name: `${className}.${m.getName()}`,
        line: m.getStartLineNumber(),
      });
    }
  }

  return found;
}

/** Walk up from a call to the nearest enclosing recorded function node id. */
function enclosingId(node: Node, declToId: Map<Node, string>): string | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    const id = declToId.get(current);
    if (id) return id;
    current = current.getParent();
  }
  return undefined;
}

/** Resolve a call's callee to an in-repo node id, if it points at one. */
function resolveCallTarget(
  call: CallExpression,
  declToId: Map<Node, string>,
): string | undefined {
  let symbol;
  try {
    symbol = call.getExpression().getSymbol();
    // Follow import aliases to the real declaration in the source module.
    if (symbol) symbol = symbol.getAliasedSymbol() ?? symbol;
  } catch {
    return undefined;
  }
  if (!symbol) return undefined;

  const decls = symbol.getDeclarations();
  for (const decl of decls) {
    const direct = declToId.get(decl);
    if (direct) return direct;
    // A method/identifier may resolve to a node we keyed on an ancestor.
    let parent: Node | undefined = decl.getParent();
    while (parent) {
      const id = declToId.get(parent);
      if (id) return id;
      parent = parent.getParent();
    }
  }
  return undefined;
}

/**
 * Does an unresolved call's callee declare inside the repo (not node_modules)?
 * True → it targets in-repo code we didn't map to a node (internal-unresolved);
 * false → a library/runtime call (external). Used only for coverage (ADR 0013).
 */
function targetsInRepo(call: CallExpression, repoRoot: string): boolean {
  let symbol;
  try {
    symbol = call.getExpression().getSymbol();
    if (symbol) symbol = symbol.getAliasedSymbol() ?? symbol;
  } catch {
    return false;
  }
  if (!symbol) return false;
  const root = toPosix(repoRoot);
  for (const decl of symbol.getDeclarations()) {
    const fp = toPosix(decl.getSourceFile().getFilePath());
    if (fp.includes("/node_modules/")) continue;
    if (fp.startsWith(root)) return true;
  }
  return false;
}

function isInRepo(filePath: string, repoRoot: string): boolean {
  const norm = toPosix(filePath);
  if (norm.includes("/node_modules/")) return false;
  return norm.startsWith(toPosix(repoRoot));
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}~${i}`)) i++;
  return `${base}~${i}`;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
