/**
 * `atlas impact <symbol|file> [--workspace <ws>] [--repo <id>] [--json]`
 *
 * "If I change this, what breaks?" Combines two layers:
 *   - intra-repo: every function that transitively calls the target
 *   - cross-repo: any repo that consumes an endpoint handled by the target
 *     (or by one of those transitive callers), via the merged map
 */

import { buildGraph } from "../core/graph.js";
import { resolveTargets } from "../core/context.js";
import { transitiveCallers } from "../core/impact.js";
import type { CrossRepoEdge } from "../core/schema.js";
import { readMap, readTopology, reposInWorkspace } from "./store.js";
import { resolveWorkspace } from "./workspace.js";

export function runImpact(args: string[]): number {
  const { query, repo, workspace, json } = parseArgs(args);
  if (!query) {
    console.error(
      "usage: atlas impact <symbol|file> [--workspace <ws>] [--repo <id>] [--json]",
    );
    return 1;
  }

  const ws = resolveWorkspace(workspace);
  if (!ws) return 1;
  const repoId = repo ?? soleRepo(ws);
  if (!repoId) return 1;

  const graph = buildGraph(readTopology(ws, repoId));
  const { nodes: targets, resolvedAs } = resolveTargets(graph, query);
  if (resolvedAs === "unresolved") {
    console.log(`No match for "${query}" in ${repoId}.`);
    return 2;
  }

  const targetIds = targets.map((t) => t.id);
  const callers = transitiveCallers(graph, targetIds);

  // Cross-repo: consumers whose link target is the target or any caller.
  const affected = new Set<string>([...targetIds, ...callers.map((c) => c.id)]);
  let crossRepo: CrossRepoEdge[] = [];
  try {
    crossRepo = readMap(ws).crossRepoEdges.filter((e) => affected.has(e.to));
  } catch {
    /* no map yet — intra-repo impact only */
  }

  if (json) {
    console.log(JSON.stringify({ query, resolvedAs, targets, callers, crossRepo }, null, 2));
    return 0;
  }

  console.log(`# impact of ${query}  (${resolvedAs} in ${repoId})\n`);
  for (const t of targets) console.log(`target: ${t.name}  ${t.file}:${t.line}`);

  console.log(`\nintra-repo — transitively affected callers (${callers.length}):`);
  for (const c of callers) console.log(`  ↑ ${c.name}  ${c.file}:${c.line}`);

  console.log(`\ncross-repo — downstream consumers (${crossRepo.length}):`);
  for (const e of crossRepo) {
    console.log(`  ⇄ ${e.contract}`);
    console.log(`      consumed by ${e.from}`);
  }
  return 0;
}

function soleRepo(workspace: string): string | undefined {
  const repos = reposInWorkspace(workspace);
  if (repos.length === 1) return repos[0];
  if (repos.length === 0) {
    console.error(`No scanned repos in workspace "${workspace}".`);
    return undefined;
  }
  console.error(`Multiple repos in "${workspace}": ${repos.join(", ")}. Use --repo <id>.`);
  return undefined;
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
