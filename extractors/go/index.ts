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
import {
  newStats,
  resolveCall,
  type Layer,
  type ResolutionStats,
} from "../shared/resolve.js";

const HTTP_VERBS = new Set(["Get", "Post", "Put", "Delete", "Patch", "Head", "Options"]);
const NEST_METHODS = new Set(["Route", "Mount"]);
const IGNORE_DIRS = new Set(["vendor", "node_modules", ".git", "bin", "dist", "build"]);

export interface GoExtractOptions {
  repoPath: string;
  repoId: string;
}

export function extractGo(opts: GoExtractOptions, stats?: ResolutionStats): ExtractorOutput {
  const root = path.resolve(opts.repoPath);
  const parser = new Parser();
  parser.setLanguage(Go);
  const st = stats ?? newStats();

  const files = walk(root);
  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];
  const exposes: ExposedEndpoint[] = [];
  const taken = new Set<string>();
  const byShortName = new Map<string, string[]>();
  const byFullName = new Map<string, string[]>(); // "Type.method" / "func" -> ids
  // Plain (non-method) funcs indexed by package dir → name, for same-package
  // resolution of unqualified calls (ADR 0012 scope layer). Go's rule: a bare
  // `f()` is a function in the caller's own package.
  const funcByPkg = new Map<string, Map<string, string[]>>();
  // Struct field types, repo-wide: Type -> field -> field's type name. Lets the
  // receiver layer walk a dispatch chain (`s.deps.Auth.Register()`) to a type.
  const structFields = new Map<string, Map<string, string>>();
  // Deeper receiver typing (ADR 0015): every declared type name (so a receiver
  // typed to a non-repo type is classified external, not internal-unresolved);
  // function/method result types (for `x := f()` / `x := r.m()`); and
  // package-level `var` types (a fallback when an identifier isn't a local).
  const repoTypes = new Set<string>();
  const funcResult = new Map<string, string>(); // func name -> first result type
  const methodResult = new Map<string, string>(); // "Type.method" -> first result type
  const pkgVarType = new Map<string, string>(); // package-level var name -> type
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

    for (const ts of descendants(tree.rootNode, "type_spec")) {
      const tname = ts.childForFieldName("name")?.text;
      if (!tname) continue;
      repoTypes.add(tname);
      const body = ts.childForFieldName("type");
      if (body?.type !== "struct_type" || structFields.has(tname)) continue;
      const fields = new Map<string, string>();
      const list = namedChildrenOfType(body, "field_declaration_list")[0];
      for (const fd of list ? namedChildrenOfType(list, "field_declaration") : []) {
        const ft = goTypeName(fd.childForFieldName("type"));
        if (!ft) continue;
        for (const id of namedChildrenOfType(fd, "field_identifier")) fields.set(id.text, ft);
      }
      if (fields.size) structFields.set(tname, fields);
    }

    // Package-level `var x T` → x's type (explicit types only; order-independent).
    for (const vd of namedChildrenOfType(tree.rootNode, "var_declaration")) {
      for (const vs of namedChildrenOfType(vd, "var_spec")) {
        const t = goTypeName(vs.childForFieldName("type"));
        if (!t) continue;
        for (const id of namedChildrenOfType(vs, "identifier")) if (!pkgVarType.has(id.text)) pkgVarType.set(id.text, t);
      }
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
      if (!name.includes(".")) pushNested(funcByPkg, posixDir(rel), name, id);
      const rt = firstResultType(fn);
      if (rt) {
        if (name.includes(".")) { if (!methodResult.has(name)) methodResult.set(name, rt); }
        else if (!funcResult.has(name)) funcResult.set(name, rt);
      }
    }
    perFile.push({ rel, root: tree.rootNode, fdToId });
  }

  const resolveConst = makeConstResolver(constNodes);
  const types: GoTypes = { structFields, funcResult, methodResult, pkgVarType };

  // Pass 2: call edges + chi exposes.
  const envCache = new Map<number, Map<string, string>>(); // func node id -> var -> type
  for (const { rel, fdToId, root: fileRoot } of perFile) {
    const moduleId = `${opts.repoId}:${rel}`;
    const pkg = posixDir(rel);
    for (const call of descendants(fileRoot, "call_expression")) {
      const fnNode = call.childForFieldName("function");
      const method = selectorField(fnNode);

      // chi expose: r.<VERB>("/path", handler)
      if (method && HTTP_VERBS.has(method)) {
        const expose = chiExpose(call, method, moduleId, byShortName, byFullName, resolveConst);
        if (expose) exposes.push(expose);
      }

      // call edge — layered resolution (ADR 0012): receiver/type → package scope
      // → repo-global, emitting only when a layer narrows to exactly one target.
      const encNode = enclosingFuncNode(call);
      const fromId = encNode ? fdToId.get(encNode.id) : undefined;
      if (!fromId) continue; // call outside any recorded func (e.g. var init) — skip

      const layers: Layer[] = [];
      if (method) {
        // `recv.method(...)` — infer the receiver expression's type (a local var,
        // field-dispatch chain, package var, or `:=`/range binding) to pin the
        // exact `Type.method`.
        const operand = fnNode.childForFieldName("operand");
        const t = goExprType(operand, goEnvFor(encNode, envCache, types), types);
        const full = t ? byFullName.get(`${t}.${method}`) : undefined;
        if (full && full.length) {
          layers.push({ via: "receiver", candidates: full });
        } else if (t && !repoTypes.has(t)) {
          // Receiver is a known *non-repo* type (sql.DB, gin.Context, …): the
          // method is external. Don't fall through to the global short name —
          // that would mis-bucket it as an ambiguous internal call (ADR 0015).
          resolveCall(fromId, [], st); // counts as external/unresolved
          continue;
        }
        // Unknown receiver type, or a repo type whose method we didn't find
        // (embedded/elsewhere): fall back to the global short name (ADR 0012).
        layers.push({ via: "global", candidates: byShortName.get(method) ?? [] });
      } else {
        // bare `f(...)` — a function in the caller's own package, then global.
        const name = identifierName(fnNode);
        if (!name) continue;
        layers.push({ via: "scope", candidates: funcByPkg.get(pkg)?.get(name) ?? [] });
        layers.push({ via: "global", candidates: byShortName.get(name) ?? [] });
      }

      const r = resolveCall(fromId, layers, st);
      if (r) edges.push({ from: fromId, to: r.to, kind: "call", line: call.startPosition.row + 1 });
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

/** Nearest enclosing function/method declaration node (for id + type env). */
function enclosingFuncNode(node: any): any | undefined {
  let p = node.parent;
  while (p) {
    if (p.type === "function_declaration" || p.type === "method_declaration") return p;
    p = p.parent;
  }
  return undefined;
}

/** Repo-wide type knowledge threaded into the per-function env + receiver typing. */
interface GoTypes {
  structFields: Map<string, Map<string, string>>;
  funcResult: Map<string, string>;
  methodResult: Map<string, string>;
  pkgVarType: Map<string, string>;
}

/**
 * Lightweight, syntactic per-function type environment: variable name → type
 * name, from the method receiver, parameters, `var`/`:=` declarations, the result
 * type of `:=` from a call (`x := f()` / `x := r.m()`), and two-variable `range`
 * element types. Not a type checker — interface values, generics, multi-return,
 * and embedded promotion are simply absent, so those calls fall through.
 */
function goEnvFor(fn: any, cache: Map<number, Map<string, string>>, T: GoTypes): Map<string, string> {
  const cached = cache.get(fn.id);
  if (cached) return cached;
  const env = new Map<string, string>();
  const elem = new Map<string, string>(); // var -> element type, for `range`
  addGoParams(fn.childForFieldName("receiver"), env, elem);
  addGoParams(fn.childForFieldName("parameters"), env, elem);
  const body = fn.childForFieldName("body");
  if (body) {
    // Assignments first (document order), so chains like `a := f(); b := a.m()`
    // and `items := []T{}` populate the env before `range items` reads it.
    for (const d of descendants(body, "short_var_declaration")) addGoAssign(d, env, elem, T);
    for (const spec of descendants(body, "var_spec")) addGoVarSpec(spec, env, elem, T);
    for (const rc of descendants(body, "range_clause")) addGoRange(rc, env, elem);
  }
  cache.set(fn.id, env);
  return env;
}

/** Bind each `name: Type` in a parameter_list (receiver or params), incl. `[]T`. */
function addGoParams(list: any, env: Map<string, string>, elem: Map<string, string>): void {
  if (!list) return;
  for (const decl of namedChildrenOfType(list, "parameter_declaration")) {
    const typeNode = decl.childForFieldName("type");
    const t = goTypeName(typeNode);
    const el = goElemType(typeNode);
    for (let i = 0; i < decl.namedChildCount; i++) {
      const c = decl.namedChild(i);
      if (c.type !== "identifier") continue;
      if (t) env.set(c.text, t);
      if (el) elem.set(c.text, el);
    }
  }
}

/** Bind `x := <expr>` — struct/composite, `&T{}`, or a call's result type. */
function addGoAssign(decl: any, env: Map<string, string>, elem: Map<string, string>, T: GoTypes): void {
  const left = decl.childForFieldName("left");
  const right = decl.childForFieldName("right");
  if (!left || !right) return;
  for (let i = 0; i < left.namedChildCount; i++) {
    const lhs = left.namedChild(i);
    if (lhs.type !== "identifier") continue;
    const rhs = right.namedChild(i);
    const t = goExprType(rhs, env, T);
    if (t) env.set(lhs.text, t);
    const el = containerElem(rhs);
    if (el) elem.set(lhs.text, el);
  }
}

/** Bind `var x T` / `var x = T{}` (and `var xs []T` for range). */
function addGoVarSpec(spec: any, env: Map<string, string>, elem: Map<string, string>, T: GoTypes): void {
  const typeNode = spec.childForFieldName("type");
  const value = spec.childForFieldName("value");
  const t = goTypeName(typeNode) ?? goExprType(value, env, T);
  const el = goElemType(typeNode) ?? containerElem(value);
  for (let i = 0; i < spec.namedChildCount; i++) {
    const c = spec.namedChild(i);
    if (c.type !== "identifier") continue;
    if (t) env.set(c.text, t);
    if (el) elem.set(c.text, el);
  }
}

/** `for i, x := range coll` → bind x to coll's element type (two-var form only). */
function addGoRange(rc: any, env: Map<string, string>, elem: Map<string, string>): void {
  const left = rc.childForFieldName("left") ?? namedChildrenOfType(rc, "expression_list")[0];
  const right = rc.childForFieldName("right") ?? rc.namedChild(rc.namedChildCount - 1);
  if (!left) return;
  const idents = namedChildrenOfType(left, "identifier");
  // Single-var range yields the index/key, not the element — skip it.
  if (idents.length < 2) return;
  const valVar = idents[idents.length - 1];
  if (!valVar || valVar.text === "_") return;
  let elemType: string | undefined;
  if (right?.type === "identifier") elemType = elem.get(right.text);
  else if (right?.type === "composite_literal") elemType = goElemType(right.childForFieldName("type"));
  if (elemType) env.set(valVar.text, elemType);
}

/** Element type of a `range` source expression we can see: a `[]T{}` literal. */
function containerElem(node: any): string | undefined {
  const n = unwrapValue(node);
  return n?.type === "composite_literal" ? goElemType(n.childForFieldName("type")) : undefined;
}

function unwrapValue(node: any): any {
  if (!node) return undefined;
  if (node.type === "expression_list") return unwrapValue(node.namedChild(0));
  if (node.type === "unary_expression") return unwrapValue(node.namedChild(0));
  if (node.type === "parenthesized_expression") return unwrapValue(node.namedChild(0));
  return node;
}

/**
 * Static type of an expression we can see: a local/package variable, a struct-
 * field chain (`s.deps.Auth`), a `T{}`/`&T{}` literal, or the result type of a
 * call (`f()` / `r.m()`). Undefined for anything not statically visible (package
 * selectors, interface values, generics) → the call falls through to the next layer.
 */
function goExprType(node: any, env: Map<string, string>, T: GoTypes): string | undefined {
  const n = node?.type === "expression_list" ? node.namedChild(0) : node;
  if (!n) return undefined;
  switch (n.type) {
    case "identifier":
      return env.get(n.text) ?? T.pkgVarType.get(n.text);
    case "parenthesized_expression":
    case "unary_expression":
      return goExprType(n.namedChild(0), env, T);
    case "composite_literal":
      return goTypeName(n.childForFieldName("type"));
    case "selector_expression": {
      const base = goExprType(n.childForFieldName("operand"), env, T);
      const field = n.childForFieldName("field")?.text;
      return base && field ? T.structFields.get(base)?.get(field) : undefined;
    }
    case "call_expression": {
      const fn = n.childForFieldName("function");
      if (fn?.type === "identifier") return T.funcResult.get(fn.text);
      if (fn?.type === "selector_expression") {
        const recv = goExprType(fn.childForFieldName("operand"), env, T);
        const m = fn.childForFieldName("field")?.text;
        return recv && m ? T.methodResult.get(`${recv}.${m}`) : undefined;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** First result type of a function/method signature (single or first-of-many). */
function firstResultType(fn: any): string | undefined {
  const res = fn.childForFieldName("result");
  if (!res) return undefined;
  if (res.type === "parameter_list") {
    const pd = namedChildrenOfType(res, "parameter_declaration")[0];
    return pd ? goTypeName(pd.childForFieldName("type")) : undefined;
  }
  return goTypeName(res);
}

/** Element type of a container type node (`[]T` / `[N]T` / `map[K]T` → `T`). */
function goElemType(t: any): string | undefined {
  if (!t) return undefined;
  if (t.type === "slice_type") return goTypeName(t.childForFieldName("element") ?? t.namedChild(0));
  if (t.type === "array_type") return goTypeName(t.childForFieldName("element"));
  if (t.type === "map_type") return goTypeName(t.childForFieldName("value"));
  return undefined;
}

/** Base type identifier of a type node (`*Service` / `pkg.Service` → "Service"). */
function goTypeName(t: any): string | undefined {
  if (!t) return undefined;
  if (t.type === "pointer_type") return goTypeName(t.namedChild(0));
  if (t.type === "type_identifier") return t.text;
  if (t.type === "qualified_type") return t.childForFieldName("name")?.text;
  if (t.type === "generic_type") return goTypeName(t.childForFieldName("type") ?? t.namedChild(0));
  return undefined;
}

function namedChildrenOfType(node: any, type: string): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c.type === type) out.push(c);
  }
  return out;
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

function pushNested(map: Map<string, Map<string, string[]>>, k1: string, k2: string, v: string): void {
  let inner = map.get(k1);
  if (!inner) {
    inner = new Map();
    map.set(k1, inner);
  }
  push(inner, k2, v);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Posix directory of a posix relative path (the Go "package" key). "" at root. */
function posixDir(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i >= 0 ? rel.slice(0, i) : "";
}
