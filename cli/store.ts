/**
 * Data-store access (ADR 0003): generated data lives ONLY in ~/.atlas
 * (override with ATLAS_HOME), never in this repo or in target repos.
 *
 * Phase 2 layout — one directory per workspace (docs/schema.md §1):
 *   ~/.atlas/<workspace>/manifest.json        the scope (which repos)
 *   ~/.atlas/<workspace>/<repoId>.topology.json   per-repo extractor output
 *   ~/.atlas/<workspace>/map.json             merged cross-repo map (§3)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtractorOutput, Manifest, MergedMap } from "../core/schema.js";
import type { DetectionResult } from "./detect.js";

export function storeRoot(): string {
  return process.env.ATLAS_HOME || path.join(os.homedir(), ".atlas");
}

export function workspaceDir(workspace: string): string {
  return path.join(storeRoot(), workspace);
}

function manifestPath(workspace: string): string {
  return path.join(workspaceDir(workspace), "manifest.json");
}

function topologyPath(workspace: string, repoId: string): string {
  return path.join(workspaceDir(workspace), `${repoId}.topology.json`);
}

function mapPath(workspace: string): string {
  return path.join(workspaceDir(workspace), "map.json");
}

function writeJson(file: string, data: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return file;
}

export function writeManifest(m: Manifest): string {
  return writeJson(manifestPath(m.workspace), m);
}

export function readManifest(workspace: string): Manifest {
  const file = manifestPath(workspace);
  if (!fs.existsSync(file)) {
    throw new Error(`No manifest for workspace "${workspace}" at ${file}.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

export function manifestExists(workspace: string): boolean {
  return fs.existsSync(manifestPath(workspace));
}

export function writeTopology(workspace: string, output: ExtractorOutput): string {
  return writeJson(topologyPath(workspace, output.repo), output);
}

export function readTopology(workspace: string, repoId: string): ExtractorOutput {
  const file = topologyPath(workspace, repoId);
  if (!fs.existsSync(file)) {
    throw new Error(`No topology for "${repoId}" in workspace "${workspace}".`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as ExtractorOutput;
}

export function readAllTopologies(workspace: string): ExtractorOutput[] {
  return reposInWorkspace(workspace).map((id) => readTopology(workspace, id));
}

export function writeMap(map: MergedMap): string {
  return writeJson(mapPath(map.workspace), map);
}

export function readMap(workspace: string): MergedMap {
  const file = mapPath(workspace);
  if (!fs.existsSync(file)) {
    throw new Error(`No map for workspace "${workspace}". Run: atlas scan first.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as MergedMap;
}

/** Per-repo stack detection (generated data, not part of the manifest contract). */
export function writeDetection(workspace: string, repoId: string, d: DetectionResult): string {
  return writeJson(path.join(workspaceDir(workspace), `${repoId}.detection.json`), d);
}

export function readDetection(workspace: string, repoId: string): DetectionResult | undefined {
  const file = path.join(workspaceDir(workspace), `${repoId}.detection.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as DetectionResult;
  } catch {
    return undefined;
  }
}

/** Repo ids that have stored topology in a workspace. */
export function reposInWorkspace(workspace: string): string[] {
  const dir = workspaceDir(workspace);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".topology.json"))
    .map((f) => f.replace(/\.topology\.json$/, ""));
}

/** All workspaces (directories holding a manifest) in the store. */
export function listWorkspaces(): string[] {
  const root = storeRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(manifestPath(d.name)))
    .map((d) => d.name);
}
