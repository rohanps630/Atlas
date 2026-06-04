/**
 * Stack detection (ADR 0009): infer a repo's languages, frameworks, role, and
 * workspace type from dependency manifests, config, build files, and file
 * extensions. Deterministic and local (ADR 0006). A *hint* that auto-fills scan
 * config (always overridable); it never errors on a wrong guess (philosophy #5).
 *
 * `inferStack` is pure (evidence → result) for testing; `detectStack` gathers
 * the evidence from disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RepoRole, WorkspaceType } from "../core/schema.js";

export interface DetectionResult {
  languages: string[];
  frameworks: string[];
  role: RepoRole;
  type: WorkspaceType;
  signals: string[];
}

export interface Evidence {
  deps: Record<string, string>; // merged dependencies + devDependencies
  rootFiles: Set<string>; // file names present at the repo root
  exts: Set<string>; // source extensions present anywhere (e.g. ".ts", ".swift")
  isPackage: boolean; // has a package.json with main/exports and not private
  monorepo: boolean; // workspaces / turbo / nx / lerna / pnpm-workspace
  goModules: string[]; // module import paths from go.mod (for backend frameworks)
}

// Go web frameworks (module path substring → display name) → imply a backend.
const GO_FRAMEWORKS: { name: string; match: string }[] = [
  { name: "chi", match: "go-chi/chi" },
  { name: "Gin", match: "gin-gonic/gin" },
  { name: "Echo", match: "labstack/echo" },
  { name: "Fiber", match: "gofiber/fiber" },
  { name: "gorilla/mux", match: "gorilla/mux" },
];

// Curated dep/config → framework signals.
const FE_FRAMEWORKS: { name: string; dep?: string; file?: string }[] = [
  { name: "Expo", dep: "expo" },
  { name: "Expo", file: "app.config.ts" },
  { name: "Expo", file: "app.config.js" },
  { name: "Expo", file: "app.json" },
  { name: "React Native", dep: "react-native" },
  { name: "Next.js", dep: "next" },
  { name: "Next.js", file: "next.config.js" },
  { name: "Next.js", file: "next.config.ts" },
  { name: "React", dep: "react" },
  { name: "Vue", dep: "vue" },
  { name: "Angular", dep: "@angular/core" },
  { name: "Svelte", dep: "svelte" },
];
const BE_FRAMEWORKS: { name: string; dep: string }[] = [
  { name: "Express", dep: "express" },
  { name: "NestJS", dep: "@nestjs/core" },
  { name: "Fastify", dep: "fastify" },
  { name: "Koa", dep: "koa" },
  { name: "hapi", dep: "@hapi/hapi" },
];
const FE_NAMES = new Set(["Expo", "React Native", "Next.js", "React", "Vue", "Angular", "Svelte"]);

export function inferStack(e: Evidence): DetectionResult {
  const signals: string[] = [];
  const frameworks: string[] = [];
  const add = (name: string, why: string) => {
    if (!frameworks.includes(name)) frameworks.push(name);
    signals.push(why);
  };

  for (const f of FE_FRAMEWORKS) {
    if (f.dep && e.deps[f.dep]) add(f.name, `dep:${f.dep}`);
    else if (f.file && e.rootFiles.has(f.file)) add(f.name, `file:${f.file}`);
  }
  for (const f of BE_FRAMEWORKS) {
    if (e.deps[f.dep]) add(f.name, `dep:${f.dep}`);
  }
  for (const f of GO_FRAMEWORKS) {
    if (e.goModules.some((m) => m.includes(f.match))) add(f.name, `go:${f.match}`);
  }

  // Languages we can extract.
  const languages: string[] = [];
  if (e.rootFiles.has("tsconfig.json") || e.exts.has(".ts") || e.exts.has(".tsx") || e.deps["typescript"]) {
    languages.push("typescript");
  } else if (e.exts.has(".js") || e.exts.has(".jsx") || Object.keys(e.deps).length > 0) {
    languages.push("javascript");
  }
  if (e.exts.has(".swift")) languages.push("swift");
  if (e.exts.has(".kt")) languages.push("kotlin");
  if (e.exts.has(".go") || e.rootFiles.has("go.mod")) languages.push("go");

  // Languages present but not yet extractable — reported, not claimed.
  for (const [file, lang] of [
    ["requirements.txt", "python"],
    ["pyproject.toml", "python"],
    ["pom.xml", "java"],
  ] as const) {
    if (e.rootFiles.has(file) && !languages.includes(lang)) {
      languages.push(`${lang} (no extractor yet)`);
      signals.push(`file:${file}`);
    }
  }

  const hasFe = frameworks.some((f) => FE_NAMES.has(f));
  const hasBe = frameworks.some((f) => !FE_NAMES.has(f));
  let role: RepoRole;
  if (hasFe) role = "fe";
  else if (hasBe) role = "be";
  else if (e.isPackage) role = "lib";
  else role = "tool";

  const type: WorkspaceType = e.monorepo ? "company" : "freelance";
  if (e.monorepo) signals.push("monorepo");

  return { languages, frameworks, role, type, signals };
}

const IGNORE_DIRS = new Set([
  "node_modules", "Pods", "build", ".gradle", "DerivedData", "dist", ".git", ".expo", "Carthage",
]);
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".swift", ".kt", ".go"]);

export function detectStack(repoPath: string): DetectionResult {
  const root = path.resolve(repoPath);
  const rootFiles = new Set(safeReaddir(root).filter((n) => fileAt(root, n)));

  let pkg: any = {};
  if (rootFiles.has("package.json")) {
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    } catch {
      pkg = {};
    }
  }
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

  const monorepo =
    !!pkg.workspaces ||
    rootFiles.has("turbo.json") ||
    rootFiles.has("nx.json") ||
    rootFiles.has("lerna.json") ||
    rootFiles.has("pnpm-workspace.yaml");
  const isPackage = !!(pkg.main || pkg.exports) && pkg.private !== true;

  const exts = collectExts(root);

  let goModules: string[] = [];
  if (rootFiles.has("go.mod")) {
    try {
      goModules = fs
        .readFileSync(path.join(root, "go.mod"), "utf8")
        .split("\n")
        .map((l) => l.trim().split(/\s+/)[0] ?? "")
        .filter((m) => m.includes("/"));
    } catch {
      goModules = [];
    }
  }

  return inferStack({ deps, rootFiles, exts, isPackage, monorepo, goModules });
}

// --- evidence helpers ---

function collectExts(root: string): Set<string> {
  const found = new Set<string>();
  (function walk(dir: string, depth: number) {
    if (found.size >= SOURCE_EXTS.size || depth > 8) return;
    for (const e of safeReaddirEnts(dir)) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        const ext = path.extname(e.name);
        if (SOURCE_EXTS.has(ext)) found.add(ext);
      }
      if (found.size >= SOURCE_EXTS.size) return;
    }
  })(root, 0);
  return found;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
function safeReaddirEnts(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function fileAt(root: string, name: string): boolean {
  try {
    return fs.statSync(path.join(root, name)).isFile();
  } catch {
    return false;
  }
}
