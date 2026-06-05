/**
 * `atlas impact <symbol|file> [--workspace <ws>] [--repo <id>] [--depth N] [--limit N] [--json]`
 * `atlas impact --diff [--base <ref>] [--repo <id>] [-w <ws>] [--depth N] [--limit N] [--json]`
 *
 * "If I change this, what breaks?" — transitive intra-repo callers plus cross-repo
 * consumers (via the merged map). `--depth` bounds how far callers are walked and
 * `--limit` caps how many are returned, keeping the answer's token cost predictable.
 * `--diff` runs it over every function touched by a git diff (ADR 0017).
 */

import * as path from "node:path";
import { queryImpact, impactForTargets, pickWorkspace, type ImpactResult } from "./query.js";
import { readManifest, readTopology } from "./store.js";
import { changedLinesByFile, changedFunctionIds } from "./gitdiff.js";

export function runImpact(args: string[]): number {
  const opts = parseArgs(args);
  if (opts.diff) return runImpactDiff(opts);

  const { query, repo, workspace, depth, limit, json } = opts;
  if (!query) {
    console.error(
      "usage: atlas impact <symbol|file> [--workspace <ws>] [--repo <id>] [--depth N] [--limit N] [--json]\n" +
        "       atlas impact --diff [--base <ref>] [--repo <id>] [-w <ws>] [--depth N] [--limit N] [--json]",
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

  printImpact(res, `# impact of ${query}  (${res.resolvedAs})`);
  return 0;
}

/** `atlas impact --diff` — blast radius of every function touched by a git diff. */
function runImpactDiff(opts: ImpactArgs): number {
  let ws: string;
  let entry;
  try {
    ws = pickWorkspace(opts.workspace);
    const manifest = readManifest(ws);
    const cwd = process.cwd();
    entry = opts.repo
      ? manifest.repos.find((r) => r.id === opts.repo)
      : manifest.repos.find((r) => isInside(cwd, r.path)) ?? (manifest.repos.length === 1 ? manifest.repos[0] : undefined);
    if (!entry) {
      console.error(
        opts.repo
          ? `No repo "${opts.repo}" in workspace "${ws}".`
          : `Could not infer which repo to diff (cwd isn't inside a workspace repo). Pass --repo <id>.`,
      );
      return 1;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const base = opts.base ?? "HEAD";
  let targetIds: string[];
  try {
    const changed = changedLinesByFile(entry.path, base);
    targetIds = changedFunctionIds(readTopology(ws, entry.id), changed);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (targetIds.length === 0) {
    const msg = `No changed functions mapped to nodes in "${entry.id}" (base ${base}).`;
    if (opts.json) console.log(JSON.stringify({ repo: entry.id, base, targets: [], callers: [], crossRepo: [] }, null, 2));
    else console.log(msg);
    return 0;
  }

  const res = impactForTargets(ws, entry.id, targetIds, { maxDepth: opts.depth, limit: opts.limit });
  if (opts.json) {
    console.log(JSON.stringify({ repo: entry.id, base, ...res }, null, 2));
    return 0;
  }
  printImpact(res, `# impact of git diff in ${entry.id}  (base ${base}, ${res.targets.length} changed function(s))`);
  return 0;
}

/** Shared human-readable rendering for both impact modes. */
function printImpact(res: ImpactResult, header: string): void {
  console.log(`${header}\n`);
  for (const t of res.targets) console.log(`target: ${t.name}  ${t.file}:${t.line}`);

  const total = res.callers.length + res.truncated;
  console.log(`\nintra-repo — transitively affected callers (${total}):`);
  for (const c of res.callers) console.log(`  ↑ ${c.name}  ${c.file}:${c.line}`);
  if (res.truncated > 0) console.log(`  … and ${res.truncated} more (raise --limit to see them)`);

  console.log(`\ncross-repo — downstream consumers (${res.crossRepo.length}):`);
  for (const e of res.crossRepo) {
    console.log(`  ⇄ ${e.contract}`);
    console.log(`      consumed by ${e.from}`);
  }
}

/** Is `child` the same as or inside directory `parent`? */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

interface ImpactArgs {
  query?: string;
  repo?: string;
  workspace?: string;
  depth?: number;
  limit?: number;
  json: boolean;
  diff: boolean;
  base?: string;
}

function parseArgs(args: string[]): ImpactArgs {
  const out: ImpactArgs = { json: false, diff: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") out.repo = args[++i];
    else if (a === "--workspace" || a === "-w") out.workspace = args[++i];
    else if (a === "--depth") out.depth = Number(args[++i]);
    else if (a === "--limit") out.limit = Number(args[++i]);
    else if (a === "--base") out.base = args[++i];
    else if (a === "--diff") out.diff = true;
    else if (a === "--json") out.json = true;
    else if (a && !a.startsWith("-")) out.query ??= a;
  }
  return out;
}
