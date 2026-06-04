/**
 * Shared query layer over the data store — used by the MCP server (and available
 * to commands). Reads stored topology/map, runs the pure core, and returns
 * structured results. Resolvers throw on ambiguity so callers can surface a
 * clear error (the MCP server turns these into tool errors).
 */

import { buildGraph } from "../core/graph.js";
import { contextPack, resolveTargets, type ContextPack } from "../core/context.js";
import { transitiveCallers } from "../core/impact.js";
import type { AtlasNode, CrossRepoEdge, MergedMap } from "../core/schema.js";
import {
  listWorkspaces,
  readMap,
  readTopology,
  reposInWorkspace,
} from "./store.js";

export function pickWorkspace(requested?: string): string {
  if (requested) return requested;
  const all = listWorkspaces();
  if (all.length === 1) return all[0]!;
  if (all.length === 0) throw new Error("No workspaces yet. Run: atlas scan <repo-path>");
  throw new Error(`Multiple workspaces (${all.join(", ")}). Pass a workspace.`);
}

export function pickRepo(workspace: string, requested?: string): string {
  if (requested) return requested;
  const repos = reposInWorkspace(workspace);
  if (repos.length === 1) return repos[0]!;
  if (repos.length === 0) throw new Error(`No scanned repos in workspace "${workspace}".`);
  throw new Error(`Multiple repos in "${workspace}" (${repos.join(", ")}). Pass a repo.`);
}

export function queryContext(query: string, workspace?: string, repo?: string): ContextPack {
  const ws = pickWorkspace(workspace);
  const graph = buildGraph(readTopology(ws, pickRepo(ws, repo)));
  return contextPack(graph, query);
}

export function queryCallers(symbol: string, workspace?: string, repo?: string): AtlasNode[] {
  const ws = pickWorkspace(workspace);
  const graph = buildGraph(readTopology(ws, pickRepo(ws, repo)));
  return graph.findBySymbol(symbol).flatMap((n) => graph.callersOf(n.id));
}

export interface ImpactResult {
  query: string;
  resolvedAs: ContextPack["resolvedAs"];
  targets: AtlasNode[];
  callers: AtlasNode[];
  crossRepo: CrossRepoEdge[];
}

export function queryImpact(query: string, workspace?: string, repo?: string): ImpactResult {
  const ws = pickWorkspace(workspace);
  const graph = buildGraph(readTopology(ws, pickRepo(ws, repo)));
  const { nodes: targets, resolvedAs } = resolveTargets(graph, query);
  const callers = transitiveCallers(graph, targets.map((t) => t.id));
  const affected = new Set<string>([...targets.map((t) => t.id), ...callers.map((c) => c.id)]);
  let crossRepo: CrossRepoEdge[] = [];
  try {
    crossRepo = readMap(ws).crossRepoEdges.filter((e) => affected.has(e.to));
  } catch {
    /* no map */
  }
  return { query, resolvedAs, targets, callers, crossRepo };
}

export function queryEndpoints(workspace?: string): MergedMap {
  return readMap(pickWorkspace(workspace));
}
