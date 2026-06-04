/**
 * Data-store access (ADR 0003): generated data lives ONLY in ~/.atlas
 * (override with ATLAS_HOME), never in this repo or in target repos.
 *
 * Phase 1 has no manifest yet (Phase 2), so a single repo's topology is stored
 * flat under the store root, keyed by repo id.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtractorOutput } from "../core/schema.js";

export function storeRoot(): string {
  return process.env.ATLAS_HOME || path.join(os.homedir(), ".atlas");
}

export function topologyPath(repoId: string): string {
  return path.join(storeRoot(), `${repoId}.topology.json`);
}

export function writeTopology(output: ExtractorOutput): string {
  const file = topologyPath(output.repo);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(output, null, 2) + "\n", "utf8");
  return file;
}

export function readTopology(repoId: string): ExtractorOutput {
  const file = topologyPath(repoId);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No topology for "${repoId}" at ${file}. Run: atlas scan <repo-path> first.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as ExtractorOutput;
}

/** List repo ids that have stored topology. */
export function listRepos(): string[] {
  const root = storeRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".topology.json"))
    .map((f) => f.replace(/\.topology\.json$/, ""));
}
