/**
 * `atlas endpoints [--workspace <ws>] [--json]`
 *
 * Shows the workspace's HTTP surface: resolved cross-repo links, and the
 * `external` endpoints (consumed but not exposed by any repo in the manifest).
 * For a lone frontend this is the headline win — the list of backends the app
 * depends on but you don't have (vision.md, principle #4).
 */

import { readMap } from "./store.js";
import { resolveWorkspace } from "./workspace.js";

export function runEndpoints(args: string[]): number {
  const { workspace, json } = parseArgs(args);
  const ws = resolveWorkspace(workspace);
  if (!ws) return 1;

  const map = readMap(ws);
  if (json) {
    console.log(JSON.stringify(map, null, 2));
    return 0;
  }

  console.log(`# endpoints — workspace "${ws}"  (repos: ${map.repos.join(", ")})\n`);

  console.log(`cross-repo links (${map.crossRepoEdges.length}):`);
  for (const e of map.crossRepoEdges) {
    console.log(`  ✔ ${e.contract}`);
    console.log(`      ${e.from}`);
    console.log(`      → ${e.to}`);
  }

  console.log(`\nexternal endpoints — consumed, not exposed here (${map.externalNodes.length}):`);
  for (const n of map.externalNodes) {
    const contract = n.id.replace(/^external:/, "");
    console.log(`  ✖ ${contract}  (${n.consumedBy.length} call site${n.consumedBy.length === 1 ? "" : "s"})`);
    for (const c of n.consumedBy) console.log(`      ← ${c}`);
  }
  return 0;
}

function parseArgs(args: string[]): { workspace?: string; json: boolean } {
  let workspace: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workspace" || a === "-w") workspace = args[++i];
    else if (a === "--json") json = true;
  }
  return { workspace, json };
}
