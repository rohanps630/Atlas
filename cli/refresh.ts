/**
 * `atlas refresh [--workspace <ws>]`
 *
 * Regenerate everything for a workspace in one command: re-scan every repo in
 * the manifest, re-link, and rewrite the agent files (architecture.md +
 * steering). Regeneration is cheap and the map is a hint, so refreshing on
 * demand beats trusting a stale map (philosophy #5). A repo whose path no longer
 * exists is skipped with a warning, not an error (principle #4).
 */

import * as fs from "node:fs";
import { extractRepoAll } from "./extract.js";
import { detectStack } from "./detect.js";
import { linkRepos } from "../core/link.js";
import {
  readAllTopologies,
  readManifest,
  writeDetection,
  writeMap,
  writeResolution,
  writeTopology,
} from "./store.js";
import { coveragePct } from "../extractors/shared/resolve.js";
import { writeAgentFiles } from "./agent.js";
import { resolveWorkspace } from "./workspace.js";

export function runRefresh(args: string[]): number {
  const ws = resolveWorkspace(parseWorkspace(args));
  if (!ws) return 1;

  const manifest = readManifest(ws);
  if (manifest.repos.length === 0) {
    console.error(`Workspace "${ws}" has no repos. Run: atlas scan <repo-path> -w ${ws}`);
    return 1;
  }

  const start = Date.now();
  let scanned = 0;
  for (const r of manifest.repos) {
    if (!fs.existsSync(r.path)) {
      console.error(`  skip ${r.id} — path no longer exists: ${r.path}`);
      continue;
    }
    writeDetection(ws, r.id, detectStack(r.path));
    const { output: out, perLanguage, resolution } = extractRepoAll(r.path, r.id);
    writeTopology(ws, out);
    writeResolution(ws, r.id, resolution);
    scanned++;
    const langs = perLanguage.map((l) => `${l.language} ${l.functions}`).join(", ");
    console.error(
      `  scanned ${r.id}: ${out.nodes.filter((n) => n.kind === "function").length} functions (${langs}), ` +
        `${out.endpoints.consumes.length} consumes, ${out.endpoints.exposes.length} exposes` +
        ` · ${coveragePct(resolution)} calls resolved`,
    );
  }

  const map = linkRepos(readAllTopologies(ws), {
    workspace: ws,
    generatedAt: new Date().toISOString(),
  });
  writeMap(map);
  writeAgentFiles(ws);

  const ms = Date.now() - start;
  console.error(
    `refreshed workspace "${ws}" in ${ms}ms: ${scanned}/${manifest.repos.length} repo(s), ` +
      `${map.crossRepoEdges.length} cross-repo edges, ${map.externalNodes.length} external endpoints`,
  );
  console.error(`regenerated architecture.md + atlas.steering.md`);
  return 0;
}

function parseWorkspace(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace" || args[i] === "-w") return args[i + 1];
  }
  return undefined;
}
