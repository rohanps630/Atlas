/**
 * `atlas status [<workspace>]`
 *
 * The dashboard: version + data-store location, then every registered workspace
 * with its repos, per-repo extraction counts, freshness, cross-repo link/extern
 * totals, and whether the agent artifacts are generated. Read-only over the data
 * store. Pass a workspace name to see only that one.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { SCHEMA_VERSION } from "../core/schema.js";
import {
  listWorkspaces,
  readManifest,
  readMap,
  readTopology,
  reposInWorkspace,
  storeRoot,
  workspaceDir,
} from "./store.js";

const VERSION = "0.1.0";

export function runStatus(args: string[]): number {
  const only = args.find((a) => !a.startsWith("-"));

  console.log(`atlas ${VERSION}    (schema v${SCHEMA_VERSION})`);
  console.log(`data store:   ${storeRoot()}`);
  console.log(`phase:        4 in progress — extractors: typescript, swift, kotlin, go`);

  let workspaces = listWorkspaces();
  if (only) workspaces = workspaces.filter((w) => w === only);

  if (workspaces.length === 0) {
    console.log("");
    console.log(only ? `No workspace "${only}".` : "No workspaces yet. Run: atlas scan <repo-path>");
    return only && listWorkspaces().length ? 1 : 0;
  }

  let totalRepos = 0;
  let totalFns = 0;
  console.log(`\nworkspaces (${workspaces.length}):`);

  for (const ws of workspaces) {
    let type = "?";
    try {
      type = readManifest(ws).type;
    } catch {
      /* ignore */
    }
    const repos = reposInWorkspace(ws);
    totalRepos += repos.length;
    console.log(`\n▸ ${ws}  [${type}]  — ${repos.length} repo(s)`);

    for (const id of repos) {
      try {
        const t = readTopology(ws, id);
        const fns = t.nodes.filter((n) => n.kind === "function").length;
        totalFns += fns;
        const calls = t.edges.filter((e) => e.kind === "call").length;
        const langs = langBreakdown(t.nodes);
        console.log(
          `  - ${id}  —  ${fns} fns · ${calls} calls · ` +
            `${t.endpoints.consumes.length} consumes · ${t.endpoints.exposes.length} exposes` +
            `   (scanned ${ago(t.generatedAt)})`,
        );
        if (langs) console.log(`      languages: ${langs}`);
      } catch {
        console.log(`  - ${id}  —  (no topology)`);
      }
    }

    try {
      const map = readMap(ws);
      console.log(`  links: ${map.crossRepoEdges.length} cross-repo · ${map.externalNodes.length} external endpoints`);
    } catch {
      console.log(`  links: (not linked yet)`);
    }
    console.log(`  agent docs:  ${agentDocs(ws)}`);
  }

  console.log(`\ntotal: ${workspaces.length} workspace(s), ${totalRepos} repo(s), ${totalFns} functions`);
  console.log(`run \`atlas --help\` for commands, \`atlas status <workspace>\` for one workspace.`);
  return 0;
}

/** Per-language function counts inferred from node file extensions. */
function langBreakdown(nodes: { kind: string; file: string }[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "function") continue;
    const lang = extLang(n.file);
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  if (counts.size <= 1) return "";
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l} ${c}`).join(", ");
}

function extLang(file: string): string {
  if (file.endsWith(".swift")) return "swift";
  if (file.endsWith(".kt")) return "kotlin";
  if (file.endsWith(".go")) return "go";
  return "ts/js";
}

function agentDocs(ws: string): string {
  const dir = workspaceDir(ws);
  const arch = path.join(dir, "architecture.md");
  const steer = path.join(dir, "atlas.steering.md");
  const both = fs.existsSync(arch) && fs.existsSync(steer);
  if (!both) return "not generated (run: atlas agent -w " + ws + ")";
  try {
    return `architecture.md + steering ✓ (${ago(fs.statSync(arch).mtime.toISOString())})`;
  } catch {
    return "architecture.md + steering ✓";
  }
}

/** Compact relative age from an ISO timestamp ("3m ago", "2h ago", "5d ago"). */
function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
