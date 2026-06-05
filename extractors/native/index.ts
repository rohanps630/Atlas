/**
 * Generic tree-sitter extractor (per ADR 0008), driven by a language registry.
 *
 * Emits the normalized schema (schema.md §2): `module` + `function` nodes and
 * name-resolved `call` edges. No type checker, so calls resolve by unique short
 * name within the repo (a hint — philosophy #5); ambiguous names are skipped.
 *
 * Adding a language = one `LANGUAGES` entry (install its tree-sitter grammar and
 * give the node-type names). Languages that follow the common
 * `function_declaration` / `call_expression` shape (Swift, Kotlin, …) reuse the
 * defaults below; others override the node-type fields. See extractors/README.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Parser from "tree-sitter";
import Swift from "tree-sitter-swift";
import Kotlin from "tree-sitter-kotlin";
import {
  SCHEMA_VERSION,
  type AtlasEdge,
  type AtlasNode,
  type ConsumedEndpoint,
  type ExtractorOutput,
} from "../../core/schema.js";
import {
  newStats,
  resolveCall,
  type Layer,
  type ResolutionStats,
} from "../shared/resolve.js";

/** Per-language tree-sitter node-type config. */
export interface LangSpec {
  grammar: unknown;
  exts: string[];
  funcType: string;          // function declaration node
  callType: string;          // call expression node
  classScopeTypes: string[]; // nodes that introduce a Type scope (for `Type.method`)
  typeDeclTypes: string[];   // all repo type declarations (incl. object/protocol),
                             // for the repo-type set used in external classification
  nameTypes: string[];       // identifier node(s) used for names / direct callees
  classNameTypes: string[];  // identifier node(s) for a class/type name
  memberType: string;        // member-access expression (e.g. `a.b`)
  memberSuffixType: string;  // the trailing `.b` part of a member access
  bindingType: string;       // local binding (`val x = ...` / `let x = ...`)
  retrofit?: boolean;        // extract Kotlin Retrofit `consumes`
}

// Swift and Kotlin share the same node-type names for what we need.
const COMMON = {
  funcType: "function_declaration",
  callType: "call_expression",
  classScopeTypes: ["class_declaration"],
  // Kotlin `object`/`interface` and Swift `protocol`/`struct`/`enum` also declare
  // repo types — include them so a receiver typed to one is classified
  // internal-unresolved, not external (ADR 0016 honesty). Method qualification +
  // field collection still key off classScopeTypes (the ones with methods/fields).
  typeDeclTypes: ["class_declaration", "object_declaration", "protocol_declaration"],
  nameTypes: ["simple_identifier"],
  classNameTypes: ["type_identifier", "simple_identifier"],
  memberType: "navigation_expression",
  memberSuffixType: "navigation_suffix",
  bindingType: "property_declaration",
};

export const LANGUAGES: Record<string, LangSpec> = {
  swift: { grammar: Swift, exts: [".swift"], ...COMMON },
  kotlin: { grammar: Kotlin, exts: [".kt"], ...COMMON, retrofit: true },
};

export type NativeLanguage = string;

/** Languages this extractor supports (registry keys) — used to auto-wire scan. */
export function nativeLanguages(): string[] {
  return Object.keys(LANGUAGES);
}

const RETROFIT_VERBS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);
// Build/vendor dirs that contain generated or third-party native code.
const IGNORE_DIRS = new Set([
  "node_modules", "Pods", "build", ".gradle", "DerivedData",
  "dist", ".git", ".expo", "Carthage",
]);

export interface NativeExtractOptions {
  repoPath: string;
  repoId: string;
  language: NativeLanguage;
}

export function extractNative(opts: NativeExtractOptions, stats?: ResolutionStats): ExtractorOutput {
  const spec = LANGUAGES[opts.language];
  if (!spec) throw new Error(`No native language spec for "${opts.language}"`);

  const root = path.resolve(opts.repoPath);
  const parser = new Parser();
  parser.setLanguage(spec.grammar);
  const st = stats ?? newStats();

  const files = walk(root, spec.exts);
  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];
  const takenIds = new Set<string>();
  const byShortName = new Map<string, string[]>(); // short fn name -> node ids
  const methodByFull = new Map<string, string[]>(); // "Class.method" -> node ids
  const classNames = new Set<string>(); // every declared type name (for receiver typing)
  const perFile: { rel: string; root: any; fdToId: Map<number, string> }[] = [];
  const constMap = new Map<string, string>(); // Kotlin `val NAME = "..."` map

  // Pass 1: module + function nodes (+ class-name and full-name indexes).
  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const moduleId = `${opts.repoId}:${rel}`;
    if (!takenIds.has(moduleId)) {
      nodes.push({ id: moduleId, kind: "module", name: path.basename(rel), file: rel, line: 1 });
      takenIds.add(moduleId);
    }

    const src = fs.readFileSync(file, "utf8");
    if (spec.retrofit) collectConsts(src, constMap);
    const tree = parseFile(parser, src, rel);
    if (!tree) continue; // unparseable file — skip, don't fail the whole scan

    for (const cls of descendants(tree.rootNode, spec.typeDeclTypes)) {
      const cn = className(cls, spec);
      if (cn) classNames.add(cn);
    }

    const fdToId = new Map<number, string>();
    for (const fd of descendants(tree.rootNode, spec.funcType)) {
      const name = functionName(fd, spec);
      if (!name) continue;
      const id = uniqueId(`${opts.repoId}:${rel}#${name}`, takenIds);
      takenIds.add(id);
      nodes.push({ id, kind: "function", name, file: rel, line: fd.startPosition.row + 1 });
      fdToId.set(fd.id, id);
      push(byShortName, shortName(name), id);
      if (name.includes(".")) push(methodByFull, name, id);
    }
    perFile.push({ rel, root: tree.rootNode, fdToId });
  }

  // Class field/property types, repo-wide (ADR 0016): Class -> field -> type. Built
  // after pass 1 so constructor-call inference sees every class name.
  const fieldsByClass = new Map<string, Map<string, string>>();
  for (const { root: fileRoot } of perFile) {
    for (const cls of descendants(fileRoot, spec.classScopeTypes)) {
      const cn = className(cls, spec);
      if (!cn) continue;
      const fm = collectFields(cls, spec, classNames);
      if (fm.size) fieldsByClass.set(cn, mergeMaps(fieldsByClass.get(cn), fm));
    }
  }

  // Pass 2: call edges — layered resolution (ADR 0012/0016): receiver/type →
  // enclosing class scope → repo-global, emitting only when a layer narrows to one.
  const envCache = new Map<number, Map<string, string>>(); // func node id -> var -> class
  for (const { root: fileRoot, fdToId } of perFile) {
    for (const call of descendants(fileRoot, spec.callType)) {
      const encNode = enclosingFunctionNode(call, spec);
      const fromId = encNode ? fdToId.get(encNode.id) : undefined;
      if (!fromId) continue;
      const callee = calleeInfo(call, spec);
      if (!callee) continue;

      const layers: Layer[] = [];
      const cls = enclosingClassName(encNode, spec);
      if (callee.kind === "bare" || callee.isSelf) {
        // bare `f()` or `this/self.f()` → prefer the enclosing class's method.
        if (cls) layers.push({ via: "scope", candidates: methodByFull.get(`${cls}.${callee.short}`) ?? [] });
        layers.push({ via: "global", candidates: byShortName.get(callee.short) ?? [] });
      } else if (callee.recvName) {
        // `x.f()` → x's type: a local/param binding, an enclosing-class field, or
        // x itself naming a class (static-style). Then the exact `Type.method`.
        const env = nativeEnvFor(encNode, spec, classNames, envCache);
        const t =
          env.get(callee.recvName) ??
          (cls ? fieldsByClass.get(cls)?.get(callee.recvName) : undefined) ??
          (classNames.has(callee.recvName) ? callee.recvName : undefined);
        const full = t ? methodByFull.get(`${t}.${callee.short}`) : undefined;
        if (full && full.length) {
          layers.push({ via: "receiver", candidates: full });
        } else if (t && !classNames.has(t)) {
          // Receiver is a known non-repo type (String, Context, …): external call
          // — don't fall through to the global short name (ADR 0016 / 0015).
          resolveCall(fromId, [], st);
          continue;
        }
        layers.push({ via: "global", candidates: byShortName.get(callee.short) ?? [] });
      } else {
        // chained / complex receiver → repo-global only (today's behavior).
        layers.push({ via: "global", candidates: byShortName.get(callee.short) ?? [] });
      }

      const r = resolveCall(fromId, layers, st);
      if (r) edges.push({ from: fromId, to: r.to, kind: "call", line: call.startPosition.row + 1 });
    }
  }

  // Pass 3 (Retrofit langs): `consumes` from @GET/@POST/... annotations.
  const consumes: ConsumedEndpoint[] = [];
  if (spec.retrofit) {
    const resolveConst = makeConstResolver(constMap);
    for (const { root: fileRoot, fdToId } of perFile) {
      for (const fd of descendants(fileRoot, spec.funcType)) {
        const c = retrofitConsume(fd, fdToId, resolveConst);
        if (c) consumes.push(c);
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    repo: opts.repoId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    endpoints: { consumes, exposes: [] },
  };
}

/** Collect Kotlin `(const) val NAME = "literal"` into a name -> raw-value map. */
function collectConsts(src: string, into: Map<string, string>): void {
  const re = /\bval\s+([A-Za-z_]\w*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!into.has(m[1]!)) into.set(m[1]!, m[2]!);
  }
}

/** Resolve a const name to its string, substituting `${X.Y}` references. */
function makeConstResolver(constMap: Map<string, string>): (name: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  const resolve = (name: string): string | undefined => {
    if (cache.has(name)) return cache.get(name);
    cache.set(name, undefined); // cycle guard
    const raw = constMap.get(name);
    if (raw === undefined) return undefined;
    const out = raw.replace(/\$\{([\w.]+)\}/g, (_, ref: string) => resolve(lastSegment(ref)) ?? "");
    cache.set(name, out);
    return out;
  };
  return resolve;
}

/** A Retrofit-annotated interface method → a consumed endpoint, else undefined. */
function retrofitConsume(
  fd: any,
  fdToId: Map<number, string>,
  resolveConst: (name: string) => string | undefined,
): ConsumedEndpoint | undefined {
  const modifiers = firstChildOfType(fd, "modifiers");
  if (!modifiers) return undefined;
  for (const ann of descendants(modifiers, "constructor_invocation")) {
    const verb = firstChildOfType(ann, "user_type")?.text?.toUpperCase();
    if (!verb || !RETROFIT_VERBS.has(verb)) continue;
    const argNode = firstChildOfType(ann, "value_arguments")?.namedChild(0);
    if (!argNode) continue;

    const argText = String(argNode.text);
    let pathVal: string | undefined;
    if (argText.startsWith('"')) {
      pathVal = argText.replace(/^"|"$/g, "").replace(/\$\{([\w.]+)\}/g, (_, r: string) => resolveConst(lastSegment(r)) ?? "");
    } else {
      pathVal = resolveConst(lastSegment(argText));
    }
    if (!pathVal) continue;

    const from = fdToId.get(fd.id);
    if (!from) continue;
    const normalized = /^https?:\/\//.test(pathVal) ? pathVal : "/" + pathVal.replace(/^\/+/, "");
    return { method: verb, path: normalized, from, line: fd.startPosition.row + 1 };
  }
  return undefined;
}

function lastSegment(ref: string): string {
  const i = ref.lastIndexOf(".");
  return i >= 0 ? ref.slice(i + 1) : ref;
}

// --- tree-sitter helpers (nodes are `any` — the grammars ship no types) ---

/**
 * Parse one file. tree-sitter's Node binding defaults to a 32KB read buffer and
 * throws "Invalid argument" on larger inputs, so size the buffer to the source.
 * A genuinely unparseable file returns undefined (skipped, not fatal).
 */
function parseFile(parser: any, src: string, rel: string): any | undefined {
  const bufferSize = Math.max(32 * 1024, Buffer.byteLength(src, "utf8") + 4096);
  try {
    return parser.parse(src, undefined, { bufferSize });
  } catch (err) {
    console.error(`  warn: could not parse ${rel} (${err instanceof Error ? err.message : err})`);
    return undefined;
  }
}

function descendants(node: any, type: string | string[]): any[] {
  const types = Array.isArray(type) ? type : [type];
  const out: any[] = [];
  (function walkNode(n: any) {
    if (types.includes(n.type)) out.push(n);
    for (let i = 0; i < n.namedChildCount; i++) walkNode(n.namedChild(i));
  })(node);
  return out;
}

function firstChildOfType(node: any, type: string): any | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c.type === type) return c;
  }
  return undefined;
}

function firstChildOfTypes(node: any, types: string[]): any | undefined {
  for (const t of types) {
    const c = firstChildOfType(node, t);
    if (c) return c;
  }
  return undefined;
}

/** Function name, qualified with its enclosing class/struct (e.g. `Foo.bar`). */
function functionName(fd: any, spec: LangSpec): string | undefined {
  const nameNode = fd.childForFieldName?.("name") ?? firstChildOfTypes(fd, spec.nameTypes);
  if (!nameNode) return undefined;
  const base = nameNode.text as string;
  const cls = enclosingClassName(fd, spec);
  return cls ? `${cls}.${base}` : base;
}

/** The declared name of a class/struct/type node. */
function className(cls: any, spec: LangSpec): string | undefined {
  const cn = cls.childForFieldName?.("name") ?? firstChildOfTypes(cls, spec.classNameTypes);
  return cn ? (cn.text as string) : undefined;
}

/** The class/struct that lexically encloses a node, if any. */
function enclosingClassName(node: any, spec: LangSpec): string | undefined {
  let p = node?.parent;
  while (p) {
    if (spec.classScopeTypes.includes(p.type)) return className(p, spec);
    p = p.parent;
  }
  return undefined;
}

interface CalleeInfo {
  short: string; // the simple method/function name being called
  kind: "bare" | "member";
  recvName?: string; // member call with a simple-identifier receiver (`x.f()`)
  isSelf?: boolean; // member call on `this`/`self`
}

/** Describe a call's target: bare name, or member access (+ its receiver). */
function calleeInfo(call: any, spec: LangSpec): CalleeInfo | undefined {
  const c0 = call.namedChild(0);
  if (!c0) return undefined;
  if (spec.nameTypes.includes(c0.type)) return { short: c0.text, kind: "bare" };
  if (c0.type === spec.memberType) {
    const suffix = lastChildOfType(c0, spec.memberSuffixType);
    if (!suffix) return undefined;
    const id = firstChildOfTypes(suffix, spec.nameTypes);
    const short = id ? id.text : String(suffix.text).replace(/^\./, "");
    if (!short) return undefined;
    const operand = c0.namedChild(0);
    const isSelf = !!operand && (operand.type === "this_expression" || operand.type === "self_expression");
    const recvName = operand && spec.nameTypes.includes(operand.type) ? operand.text : undefined;
    return { short, kind: "member", recvName, isSelf };
  }
  return undefined;
}

/**
 * Per-function binding environment: variable name → declared type name (ADR 0016).
 * Sources: function **parameters** (`fun f(x: T)` / `func f(x: T)`), and local
 * `val/let` bindings — either type-annotated (`val x: T`) or a constructor call
 * of a repo class (`val x = Foo()`). Only types declared in the repo are useful
 * downstream; syntactic and best-effort (philosophy #5).
 */
function nativeEnvFor(
  fn: any,
  spec: LangSpec,
  classNames: Set<string>,
  cache: Map<number, Map<string, string>>,
): Map<string, string> {
  const cached = cache.get(fn.id);
  if (cached) return cached;
  const env = new Map<string, string>();
  for (const p of paramNodes(fn)) {
    const name = bindingName(p);
    const type = bindingType(p, classNames);
    if (name && type) env.set(name, type);
  }
  for (const binding of descendants(fn, spec.bindingType)) {
    const name = bindingName(binding);
    const type = bindingType(binding, classNames);
    if (name && type) env.set(name, type);
  }
  cache.set(fn.id, env);
  return env;
}

/** Function parameters: direct `parameter` children, or Kotlin's wrapped ones. */
function paramNodes(fn: any): any[] {
  const out: any[] = [];
  for (let i = 0; i < fn.namedChildCount; i++) {
    const c = fn.namedChild(i);
    if (c.type === "parameter") out.push(c);
    else if (c.type === "function_value_parameters") {
      for (let j = 0; j < c.namedChildCount; j++) {
        if (c.namedChild(j).type === "parameter") out.push(c.namedChild(j));
      }
    }
  }
  return out;
}

/** The bound variable name of a param/property/class-parameter declaration. */
function bindingName(node: any): string | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    const t = c.type;
    if (
      t === "user_type" || t === "type_annotation" || t === "call_expression" ||
      t === "modifiers" || t === "binding_pattern_kind" || t === "value_binding_pattern"
    ) continue;
    if (t === "simple_identifier") return c.text;
    if (t === "variable_declaration" || t === "pattern") {
      const id = firstDescendantOfTypes(c, ["simple_identifier"]);
      if (id) return id.text;
    }
  }
  return undefined;
}

/**
 * The declared type of a binding: its type annotation (`: T`, taken from the
 * declaration's own `user_type`, not from any value expression), else the class
 * of a constructor-call initializer (`= Foo()` when `Foo` is a repo class).
 */
function bindingType(node: any, classNames: Set<string>): string | undefined {
  // Swift: `type_annotation > user_type`; Kotlin: a `user_type` directly on the
  // declaration (or its `variable_declaration`). Restrict to those so we never
  // pick up a `user_type` from inside the initializer expression.
  const ann = firstChildOfType(node, "type_annotation");
  const vd = firstChildOfType(node, "variable_declaration");
  const ut =
    firstChildOfType(node, "user_type") ??
    (ann && firstChildOfType(ann, "user_type")) ??
    (vd && firstChildOfType(vd, "user_type"));
  if (ut) {
    const ti = firstDescendantOfTypes(ut, ["type_identifier"]);
    if (ti) return ti.text;
  }
  const call = firstChildOfType(node, "call_expression");
  const callee = call?.namedChild(0);
  if (callee?.type === "simple_identifier" && classNames.has(callee.text)) return callee.text;
  return undefined;
}

/** Class field/property types: stored properties + Kotlin constructor `val/var`. */
function collectFields(cls: any, spec: LangSpec, classNames: Set<string>): Map<string, string> {
  const fields = new Map<string, string>();
  const add = (decl: any) => {
    const name = bindingName(decl);
    const type = bindingType(decl, classNames);
    if (name && type) fields.set(name, type);
  };
  const ctor = firstChildOfType(cls, "primary_constructor");
  if (ctor) for (const cp of namedChildrenOfType(ctor, "class_parameter")) {
    if (firstChildOfType(cp, "binding_pattern_kind")) add(cp); // `val/var` → a property
  }
  const body = firstChildOfType(cls, "class_body");
  if (body) for (const pd of namedChildrenOfType(body, spec.bindingType)) add(pd);
  return fields;
}

function namedChildrenOfType(node: any, type: string): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c.type === type) out.push(c);
  }
  return out;
}

/** Merge `b` into `a` (first value wins); returns the merged map. */
function mergeMaps(a: Map<string, string> | undefined, b: Map<string, string>): Map<string, string> {
  if (!a) return b;
  for (const [k, v] of b) if (!a.has(k)) a.set(k, v);
  return a;
}

function firstDescendantOfTypes(node: any, types: string[]): any | undefined {
  if (types.includes(node.type)) return node;
  for (let i = 0; i < node.namedChildCount; i++) {
    const found = firstDescendantOfTypes(node.namedChild(i), types);
    if (found) return found;
  }
  return undefined;
}

function lastChildOfType(node: any, type: string): any | undefined {
  let found: any;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c.type === type) found = c;
  }
  return found;
}

/** Walk up to the nearest enclosing function declaration node. */
function enclosingFunctionNode(node: any, spec: LangSpec): any | undefined {
  let p = node.parent;
  while (p) {
    if (p.type === spec.funcType) return p;
    p = p.parent;
  }
  return undefined;
}

function shortName(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1) : name;
}

// --- file discovery ---

function walk(dir: string, exts: string[]): string[] {
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
      out.push(...walk(path.join(dir, e.name), exts));
    } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) {
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
