/**
 * Go extractor (tree-sitter, per ADR 0010).
 *
 * Emits the normalized schema (schema.md §2): `module` + `function` nodes
 * (methods named `Recv.method`), name-resolved `call` edges, and — the Go-
 * specific payoff — `exposes` for chi routes. chi nests routes via
 * `r.Route("/prefix", func(r chi.Router){ ... })`, so each leaf
 * `r.Get("/x", handler)` is walked up its ancestors to collect enclosing Route/
 * Mount prefixes; constant prefixes (e.g. `api.BasePath = prefix + Version`) are
 * resolved through a repo-wide const map. Syntactic and name-based — a hint (#5).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Parser from "tree-sitter";
import Go from "tree-sitter-go";
import {
  SCHEMA_VERSION,
  type AtlasEdge,
  type AtlasNode,
  type ExposedEndpoint,
  type ExtractorOutput,
} from "../../core/schema.js";

const HTTP_VERBS = new Set(["Get", "Post", "Put", "Delete", "Patch", "Head", "Options"]);
const NEST_METHODS = new Set(["Route", "Mount"]);
const IGNORE_DIRS = new Set(["vendor", "node_modules", ".git", "bin", "dist", "build"]);

export interface GoExtractOptions {
  repoPath: string;
  repoId: string;
}

export function extractGo(opts: GoExtractOptions): ExtractorOutput {
  const root = path.resolve(opts.repoPath);
  const parser = new Parser();
  parser.setLanguage(Go);

  const files = walk(root);
  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];
  const exposes: ExposedEndpoint[] = [];
  const taken = new Set<string>();
  const byShortName = new Map<string, string[]>();
  const byFullName = new Map<string, string[]>(); // "Type.method" / "func" -> ids
  const constNodes = new Map<string, any>(); // const name -> value node
  const perFile: { rel: string; root: any; fdToId: Map<number, string> }[] = [];

  // Pass 1: nodes + collect const specs.
  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const tree = parseFile(parser, fs.readFileSync(file, "utf8"), rel);
    if (!tree) continue;

    const moduleId = `${opts.repoId}:${rel}`;
    if (!taken.has(moduleId)) {
      nodes.push({ id: moduleId, kind: "module", name: path.basename(rel), file: rel, line: 1 });
      taken.add(moduleId);
    }

    for (const c of descendants(tree.rootNode, "const_spec")) {
      const name = c.childForFieldName("name")?.text;
      const value = c.childForFieldName("value")?.namedChild(0);
      if (name && value && !constNodes.has(name)) constNodes.set(name, value);
    }

    const fdToId = new Map<number, string>();
    for (const fn of [
      ...descendants(tree.rootNode, "function_declaration"),
      ...descendants(tree.rootNode, "method_declaration"),
    ]) {
      const name = funcName(fn);
      if (!name) continue;
      const id = uniqueId(`${opts.repoId}:${rel}#${name}`, taken);
      taken.add(id);
      nodes.push({ id, kind: "function", name, file: rel, line: fn.startPosition.row + 1 });
      fdToId.set(fn.id, id);
      push(byShortName, shortName(name), id);
      push(byFullName, name, id);
    }
    perFile.push({ rel, root: tree.rootNode, fdToId });
  }

  const resolveConst = makeConstResolver(constNodes);

  // Pass 2: call edges + chi exposes.
  for (const { rel, fdToId, root: fileRoot } of perFile) {
    const moduleId = `${opts.repoId}:${rel}`;
    for (const call of descendants(fileRoot, "call_expression")) {
      const fnNode = call.childForFieldName("function");
      const method = selectorField(fnNode);

      // chi expose: r.<VERB>("/path", handler)
      if (method && HTTP_VERBS.has(method)) {
        const expose = chiExpose(call, method, moduleId, byShortName, byFullName, resolveConst);
        if (expose) exposes.push(expose);
      }

      // call edge resolved by unique short name
      const callee = method ?? identifierName(fnNode);
      if (callee) {
        const matches = byShortName.get(callee);
        if (matches && matches.length === 1) {
          const fromId = enclosingFuncId(call, fdToId);
          if (fromId && fromId !== matches[0]) {
            edges.push({ from: fromId, to: matches[0]!, kind: "call", line: call.startPosition.row + 1 });
          }
        }
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    repo: opts.repoId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    endpoints: { consumes: [], exposes },
  };
}

function chiExpose(
  call: any,
  method: string,
  moduleId: string,
  byShortName: Map<string, string[]>,
  byFullName: Map<string, string[]>,
  resolveConst: (node: any) => string | undefined,
): ExposedEndpoint | undefined {
  const args = call.childForFieldName("arguments");
  const pathArg = args?.namedChild(0);
  const leaf = stringValue(pathArg);
  // A chi route literal always starts with "/" and is registered with a handler
  // argument. This rejects look-alikes like url.Values.Get("kind") /
  // header.Get("X-…") that share the verb method name but aren't routes.
  if (leaf === undefined || !leaf.startsWith("/")) return undefined;
  if (!args || args.namedChildCount < 2) return undefined;

  // Collect enclosing Route/Mount prefixes (innermost → outermost), then reverse.
  const prefixes: string[] = [];
  let p = call.parent;
  while (p) {
    if (p.type === "call_expression") {
      const m = selectorField(p.childForFieldName("function"));
      if (m && NEST_METHODS.has(m)) {
        const pre = stringValue(p.childForFieldName("arguments")?.namedChild(0), resolveConst);
        if (pre !== undefined) prefixes.push(pre);
      }
    }
    p = p.parent;
  }
  prefixes.reverse();
  const full = ("/" + [...prefixes, leaf].join("/")).replace(/\/+/g, "/");

  // Handler = 2nd arg. Prefer a precise "Type.method" match (e.g.
  // deps.AdminHandler.ListClinics → AdminHandler.ListClinics), then a unique
  // short name. If neither resolves (inline/ambiguous handler), point at the
  // file's module node — honest "registered here", not a wrong function.
  let handler = moduleId;
  const handlerArg = args?.namedChild(1);
  const full2 = typeMethodName(handlerArg);
  const short = selectorField(handlerArg) ?? identifierName(handlerArg);
  const byFull = full2 ? byFullName.get(full2) : undefined;
  const byShort = short ? byShortName.get(short) : undefined;
  if (byFull && byFull.length === 1) handler = byFull[0]!;
  else if (byShort && byShort.length === 1) handler = byShort[0]!;

  return { method: method.toUpperCase(), path: full, handler, line: call.startPosition.row + 1 };
}

/** Resolve a Go const expression node to a string (literal or `a + b` of consts). */
function makeConstResolver(constNodes: Map<string, any>): (node: any) => string | undefined {
  const cache = new Map<string, string | undefined>();
  const resolveName = (name: string, seen: Set<string>): string | undefined => {
    if (cache.has(name)) return cache.get(name);
    if (seen.has(name)) return undefined;
    seen.add(name);
    const node = constNodes.get(name);
    const v = node ? resolveNode(node, seen) : undefined;
    cache.set(name, v);
    return v;
  };
  const resolveNode = (node: any, seen: Set<string>): string | undefined => {
    if (!node) return undefined;
    if (node.type === "interpreted_string_literal" || node.type === "raw_string_literal") {
      return unquote(node.text);
    }
    if (node.type === "identifier") return resolveName(node.text, seen);
    if (node.type === "selector_expression") {
      const field = node.childForFieldName("field")?.text;
      return field ? resolveName(field, seen) : undefined;
    }
    if (node.type === "binary_expression") {
      const l = resolveNode(node.childForFieldName("left"), seen);
      const r = resolveNode(node.childForFieldName("right"), seen);
      return l !== undefined && r !== undefined ? l + r : undefined;
    }
    return undefined;
  };
  return (node: any) => resolveNode(node, new Set());
}

// --- node helpers ---

/** String value of an arg: a string literal, or a resolvable const expression. */
function stringValue(node: any, resolveConst?: (n: any) => string | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "interpreted_string_literal" || node.type === "raw_string_literal") {
    return unquote(node.text);
  }
  return resolveConst ? resolveConst(node) : undefined;
}

/** The method name of a selector call (`r.Get` → "Get", `a.b().Get` → "Get"). */
function selectorField(fnNode: any): string | undefined {
  if (fnNode?.type === "selector_expression") return fnNode.childForFieldName("field")?.text;
  return undefined;
}

function identifierName(fnNode: any): string | undefined {
  return fnNode?.type === "identifier" ? fnNode.text : undefined;
}

/** "Type.method" from a handler selector (`deps.AdminHandler.ListClinics`). */
function typeMethodName(node: any): string | undefined {
  if (node?.type !== "selector_expression") return undefined;
  const method = node.childForFieldName("field")?.text;
  const operand = node.childForFieldName("operand");
  const type = operand?.type === "selector_expression"
    ? operand.childForFieldName("field")?.text
    : identifierName(operand);
  return method && type ? `${type}.${method}` : undefined;
}

function funcName(fn: any): string | undefined {
  const name = fn.childForFieldName("name")?.text;
  if (!name) return undefined;
  if (fn.type === "method_declaration") {
    const recv = fn.childForFieldName("receiver")?.text ?? "";
    const m = recv.match(/\*?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*$/);
    if (m) return `${m[1]}.${name}`;
  }
  return name;
}

function enclosingFuncId(node: any, fdToId: Map<number, string>): string | undefined {
  let p = node.parent;
  while (p) {
    if (p.type === "function_declaration" || p.type === "method_declaration") {
      const id = fdToId.get(p.id);
      if (id) return id;
    }
    p = p.parent;
  }
  return undefined;
}

function descendants(node: any, type: string): any[] {
  const out: any[] = [];
  (function w(n: any) {
    if (n.type === type) out.push(n);
    for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i));
  })(node);
  return out;
}

function shortName(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1) : name;
}

function unquote(t: string): string {
  return t.replace(/^[`"]|[`"]$/g, "");
}

function parseFile(parser: any, src: string, rel: string): any | undefined {
  const bufferSize = Math.max(32 * 1024, Buffer.byteLength(src, "utf8") + 4096);
  try {
    return parser.parse(src, undefined, { bufferSize });
  } catch (err) {
    console.error(`  warn: could not parse ${rel} (${err instanceof Error ? err.message : err})`);
    return undefined;
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out.push(...walk(path.join(dir, e.name)));
    } else if (e.isFile() && e.name.endsWith(".go") && !e.name.endsWith("_test.go")) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}~${i}`)) i++;
  return `${base}~${i}`;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
