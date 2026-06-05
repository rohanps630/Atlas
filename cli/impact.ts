/**
 * `atlas impact <symbol|file> [--workspace <ws>] [--repo <id>] [--depth N] [--limit N] [--json]`
 *
 * "If I change this, what breaks?" — transitive intra-repo callers plus cross-repo
 * consumers (via the merged map). `--depth` bounds how far callers are walked and
 * `--limit` caps how many are returned, keeping the answer's token cost predictable.
 */

import { queryImpact } from "./query.js";

export function runImpact(args: string[]): number {
  const { query, repo, workspace, depth, limit, json } = parseArgs(args);
  if (!query) {
    console.error(
      "usage: atlas impact <symbol|file> [--workspace <ws>] [--repo <id>] [--depth N] [--limit N] [--json]",
    );
    return 1;
  }

  let res;
  try {
    res = queryImpact(query, workspace, repo, { maxDepth: depth, limit });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return res.resolvedAs === "unresolved" ? 2 : 0;
  }

  if (res.resolvedAs === "unresolved") {
    console.log(`No match for "${query}".`);
    return 2;
  }

  console.log(`# impact of ${query}  (${res.resolvedAs})\n`);
  for (const t of res.targets) console.log(`target: ${t.name}  ${t.file}:${t.line}`);

  const shown = res.callers.length;
  const total = shown + res.truncated;
  console.log(`\nintra-repo — transitively affected callers (${total}):`);
  for (const c of res.callers) console.log(`  ↑ ${c.name}  ${c.file}:${c.line}`);
  if (res.truncated > 0) console.log(`  … and ${res.truncated} more (raise --limit to see them)`);

  console.log(`\ncross-repo — downstream consumers (${res.crossRepo.length}):`);
  for (const e of res.crossRepo) {
    console.log(`  ⇄ ${e.contract}`);
    console.log(`      consumed by ${e.from}`);
  }
  return 0;
}

function parseArgs(args: string[]): {
  query?: string;
  repo?: string;
  workspace?: string;
  depth?: number;
  limit?: number;
  json: boolean;
} {
  let query: string | undefined;
  let repo: string | undefined;
  let workspace: string | undefined;
  let depth: number | undefined;
  let limit: number | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") repo = args[++i];
    else if (a === "--workspace" || a === "-w") workspace = args[++i];
    else if (a === "--depth") depth = Number(args[++i]);
    else if (a === "--limit") limit = Number(args[++i]);
    else if (a === "--json") json = true;
    else if (a && !a.startsWith("-")) query ??= a;
  }
  return { query, repo, workspace, depth, limit, json };
}
