/**
 * `atlas scan <repo-path> [--id <id>] [--workspace <ws>] [--role fe|be|lib|tool]`
 *
 * Extracts a repo into a workspace: upserts it into the workspace manifest,
 * writes its topology, then re-links every repo in the workspace and writes the
 * merged map. The target repo is read-only; output goes only to ~/.atlas
 * (ADR 0003). A single-repo scan just makes a one-repo workspace (default
 * workspace name = repo id).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { extractRepo } from "../extractors/typescript/index.js";
import { linkRepos } from "../core/link.js";
import type { Manifest, RepoEntry, RepoRole, WorkspaceType } from "../core/schema.js";
import {
  manifestExists,
  readAllTopologies,
  readManifest,
  writeManifest,
  writeMap,
  writeTopology,
} from "./store.js";

const ROLES: RepoRole[] = ["fe", "be", "lib", "tool"];

export function runScan(args: string[]): number {
  const opts = parseArgs(args);
  if (!opts.repoPath) {
    console.error(
      "usage: atlas scan <repo-path> [--id <id>] [--workspace <ws>] [--role fe|be|lib|tool]",
    );
    return 1;
  }

  const abs = path.resolve(opts.repoPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    console.error(`Not a directory: ${abs}`);
    return 1;
  }

  const id = opts.id ?? path.basename(abs);
  const workspace = opts.workspace ?? id;
  const role: RepoRole = opts.role ?? "fe";

  // Upsert this repo into the workspace manifest.
  const manifest = loadOrInitManifest(workspace, opts.type);
  const entry: RepoEntry = { id, path: abs, role, language: "typescript" };
  manifest.repos = [...manifest.repos.filter((r) => r.id !== id), entry];
  writeManifest(manifest);

  console.error(`scanning ${abs} as "${id}" (workspace "${workspace}", role ${role}) …`);
  const start = Date.now();
  const output = extractRepo({ repoPath: abs, repoId: id });
  writeTopology(workspace, output);
  const ms = Date.now() - start;

  const fns = output.nodes.filter((n) => n.kind === "function").length;
  const calls = output.edges.filter((e) => e.kind === "call").length;
  const imports = output.edges.filter((e) => e.kind === "import").length;
  const consumes = output.endpoints.consumes.length;
  console.error(
    `done in ${ms}ms: ${fns} functions, ${calls} calls, ${imports} imports, ${consumes} consumes`,
  );

  // Re-link the whole workspace and write the merged map.
  const map = linkRepos(readAllTopologies(workspace), {
    workspace,
    generatedAt: new Date().toISOString(),
  });
  writeMap(map);
  console.error(
    `linked ${map.repos.length} repo(s): ${map.crossRepoEdges.length} cross-repo edges, ${map.externalNodes.length} external endpoints`,
  );
  return 0;
}

function loadOrInitManifest(workspace: string, type: WorkspaceType | undefined): Manifest {
  if (manifestExists(workspace)) {
    const m = readManifest(workspace);
    if (type) m.type = type;
    return m;
  }
  return { schemaVersion: 0, workspace, type: type ?? "freelance", repos: [] };
}

interface ScanArgs {
  repoPath?: string;
  id?: string;
  workspace?: string;
  role?: RepoRole;
  type?: WorkspaceType;
}

function parseArgs(args: string[]): ScanArgs {
  const out: ScanArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--id") out.id = args[++i];
    else if (a === "--workspace" || a === "-w") out.workspace = args[++i];
    else if (a === "--role") {
      const r = args[++i];
      if (r && (ROLES as string[]).includes(r)) out.role = r as RepoRole;
    } else if (a === "--type") {
      const t = args[++i];
      if (t === "freelance" || t === "company") out.type = t;
    } else if (a && !a.startsWith("-")) out.repoPath ??= a;
  }
  return out;
}
