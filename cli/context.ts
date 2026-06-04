/**
 * `atlas context <symbol|file> [--repo <id>] [--json]`
 *
 * Loads a repo's stored topology, builds the intra-repo graph, and prints a
 * focused context pack: the target(s) plus their callers and callees. This is
 * the Phase 1 thing you read while working.
 */

import { buildGraph } from "../core/graph.js";
import { contextPack, type ContextPack } from "../core/context.js";
import { readTopology, reposInWorkspace } from "./store.js";
import { resolveWorkspace } from "./workspace.js";

export function runContext(args: string[]): number {
  const { query, repo, workspace, json } = parseArgs(args);
  if (!query) {
    console.error(
      "usage: atlas context <symbol|file> [--workspace <ws>] [--repo <id>] [--json]",
    );
    return 1;
  }

  const ws = resolveWorkspace(workspace);
  if (!ws) return 1;

  const repoId = repo ?? soleRepo(ws);
  if (!repoId) return 1;

  const graph = buildGraph(readTopology(ws, repoId));
  const pack = contextPack(graph, query);

  if (json) {
    console.log(JSON.stringify(pack, null, 2));
  } else {
    printPack(pack, repoId);
  }
  return pack.resolvedAs === "unresolved" ? 2 : 0;
}

/** With no --repo, use the only repo in the workspace; otherwise ask. */
function soleRepo(workspace: string): string | undefined {
  const repos = reposInWorkspace(workspace);
  if (repos.length === 1) return repos[0];
  if (repos.length === 0) {
    console.error(`No scanned repos in workspace "${workspace}". Run: atlas scan <repo-path>`);
    return undefined;
  }
  console.error(`Multiple repos in "${workspace}": ${repos.join(", ")}`);
  console.error("Pick one with --repo <id>.");
  return undefined;
}

function printPack(pack: ContextPack, repoId: string): void {
  if (pack.resolvedAs === "unresolved") {
    console.log(`No match for "${pack.query}" in ${repoId}.`);
    console.log("Try a function name, a file path, or a full node id.");
    return;
  }

  console.log(`# ${pack.query}  (matched as ${pack.resolvedAs} in ${repoId})\n`);
  for (const t of pack.targets) {
    console.log(`${t.node.name}  [${t.node.kind}]`);
    console.log(`  ${t.node.file}:${t.node.line}`);
    console.log(`  id: ${t.node.id}`);

    console.log(`  called by (${t.callers.length}):`);
    for (const c of t.callers) console.log(`    ← ${c.name}  ${c.file}:${c.line}`);

    console.log(`  calls (${t.callees.length}):`);
    for (const c of t.callees) console.log(`    → ${c.name}  ${c.file}:${c.line}`);
    console.log("");
  }
}

function parseArgs(args: string[]): {
  query?: string;
  repo?: string;
  workspace?: string;
  json: boolean;
} {
  let query: string | undefined;
  let repo: string | undefined;
  let workspace: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") repo = args[++i];
    else if (a === "--workspace" || a === "-w") workspace = args[++i];
    else if (a === "--json") json = true;
    else if (a && !a.startsWith("-")) query ??= a;
  }
  return { query, repo, workspace, json };
}
