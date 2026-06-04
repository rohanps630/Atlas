/**
 * Swift & Kotlin extractor (tree-sitter, per ADR 0008).
 *
 * One generic tree-sitter extractor for both languages — their grammars share
 * the node types we need (`function_declaration`, `call_expression`,
 * `class_declaration`, `navigation_expression`). Emits the same normalized JSON
 * as every other extractor (schema.md §2): `module` + `function` nodes and
 * name-resolved `call` edges. No type checker, so calls resolve by name within
 * the repo (the map is a hint — philosophy #5); ambiguous names are skipped to
 * avoid misleading edges. Scope: functions + calls, mirroring the Phase 1 TS extractor.
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

const RETROFIT_VERBS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

export type NativeLanguage = "swift" | "kotlin";

const GRAMMAR: Record<NativeLanguage, unknown> = { swift: Swift, kotlin: Kotlin };
const EXT: Record<NativeLanguage, string> = { swift: ".swift", kotlin: ".kt" };
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

export function extractNative(opts: NativeExtractOptions): ExtractorOutput {
  const root = path.resolve(opts.repoPath);
  const parser = new Parser();
  parser.setLanguage(GRAMMAR[opts.language]);

  const files = walk(root, EXT[opts.language]);
  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];
  const takenIds = new Set<string>();
  const byShortName = new Map<string, string[]>(); // short fn name -> node ids
  // Per file: the parse tree + a map from function_declaration node id -> our node id.
  const perFile: { rel: string; root: any; fdToId: Map<number, string> }[] = [];
  // Kotlin `(const) val NAME = "..."` map (short name -> raw value, may contain ${...}).
  const constMap = new Map<string, string>();

  // Pass 1: nodes.
  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const moduleId = `${opts.repoId}:${rel}`;
    if (!takenIds.has(moduleId)) {
      nodes.push({ id: moduleId, kind: "module", name: path.basename(rel), file: rel, line: 1 });
      takenIds.add(moduleId);
    }

    const src = fs.readFileSync(file, "utf8");
    if (opts.language === "kotlin") collectConsts(src, constMap);
    const tree = parseFile(parser, src, rel);
    if (!tree) continue; // unparseable file — skip, don't fail the whole scan
    const fdToId = new Map<number, string>();
    for (const fd of descendants(tree.rootNode, "function_declaration")) {
      const name = functionName(fd);
      if (!name) continue;
      const id = uniqueId(`${opts.repoId}:${rel}#${name}`, takenIds);
      takenIds.add(id);
      nodes.push({ id, kind: "function", name, file: rel, line: fd.startPosition.row + 1 });
      fdToId.set(fd.id, id);
      push(byShortName, shortName(name), id);
    }
    perFile.push({ rel, root: tree.rootNode, fdToId });
  }

  // Pass 2: call edges (resolved by unique short name within the repo).
  for (const { root: fileRoot, fdToId } of perFile) {
    for (const call of descendants(fileRoot, "call_expression")) {
      const fromId = enclosingFunctionId(call, fdToId);
      if (!fromId) continue;
      const callee = calleeName(call);
      if (!callee) continue;
      const matches = byShortName.get(callee);
      if (!matches || matches.length !== 1) continue; // unresolved or ambiguous → skip
      const toId = matches[0]!;
      if (toId === fromId) continue;
      edges.push({ from: fromId, to: toId, kind: "call", line: call.startPosition.row + 1 });
    }
  }

  // Pass 3 (Kotlin only): Retrofit `consumes` from @GET/@POST/... annotations.
  const consumes: ConsumedEndpoint[] = [];
  if (opts.language === "kotlin") {
    const resolveConst = makeConstResolver(constMap);
    for (const { root: fileRoot, fdToId } of perFile) {
      for (const fd of descendants(fileRoot, "function_declaration")) {
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

function descendants(node: any, type: string): any[] {
  const out: any[] = [];
  (function walkNode(n: any) {
    if (n.type === type) out.push(n);
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

/** Function name, qualified with its enclosing class/struct (e.g. `Foo.bar`). */
function functionName(fd: any): string | undefined {
  const nameNode = fd.childForFieldName?.("name") ?? firstChildOfType(fd, "simple_identifier");
  if (!nameNode) return undefined;
  const base = nameNode.text as string;

  let p = fd.parent;
  while (p) {
    if (p.type === "class_declaration") {
      const cn = p.childForFieldName?.("name") ?? firstChildOfType(p, "type_identifier") ?? firstChildOfType(p, "simple_identifier");
      return cn ? `${cn.text}.${base}` : base;
    }
    p = p.parent;
  }
  return base;
}

/** The simple name a call targets (last segment of a member access). */
function calleeName(call: any): string | undefined {
  const c0 = call.namedChild(0);
  if (!c0) return undefined;
  if (c0.type === "simple_identifier") return c0.text;
  if (c0.type === "navigation_expression") {
    const suffix = lastChildOfType(c0, "navigation_suffix");
    if (suffix) {
      const id = firstChildOfType(suffix, "simple_identifier");
      return id ? id.text : String(suffix.text).replace(/^\./, "");
    }
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

/** Walk up to the nearest enclosing recorded function_declaration's node id. */
function enclosingFunctionId(node: any, fdToId: Map<number, string>): string | undefined {
  let p = node.parent;
  while (p) {
    if (p.type === "function_declaration") {
      const id = fdToId.get(p.id);
      if (id) return id;
    }
    p = p.parent;
  }
  return undefined;
}

function shortName(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1) : name;
}

// --- file discovery ---

function walk(dir: string, ext: string): string[] {
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
      out.push(...walk(path.join(dir, e.name), ext));
    } else if (e.isFile() && e.name.endsWith(ext)) {
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
