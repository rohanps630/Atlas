/**
 * Shared query layer over the data store — used by the MCP server (and available
 * to commands). Reads stored topology/map, runs the pure core, and returns
 * structured results. Resolvers throw on ambiguity so callers can surface a
 * clear error (the MCP server turns these into tool errors).
 */

import { buildGraph, Graph } from "../core/graph.js";
import { contextPack, resolveTargets, type ContextPack } from "../core/context.js";
import { transitiveCallers } from "../core/impact.js";
import { shortestPath, type PathResult } from "../core/path.js";
import { neighborhood, type Neighborhood } from "../core/neighborhood.js";
import type { AtlasEdge, AtlasNode, CrossRepoEdge, MergedMap } from "../core/schema.js";
import {
  listWorkspaces,
  readAllTopologies,
  readMap,
  readTopology,
  reposInWorkspace,
} from "./store.js";

/** Default cap on list sizes in structured (MCP) results, to bound token cost. */
export const DEFAULT_LIMIT = 50;

/** Cap a list, returning the slice plus how many were dropped. */
export function cap<T>(items: T[], limit = DEFAULT_LIMIT): { items: T[]; truncated: number } {
  return limit >= items.length
    ? { items, truncated: 0 }
    : { items: items.slice(0, limit), truncated: items.length - limit };
}

/**
 * A single graph spanning every repo in the workspace: all nodes/edges plus the
 * resolved cross-repo `http` contract edges. Used for path queries.
 */
export function workspaceGraph(workspace: string): Graph {
  const tops = readAllTopologies(workspace);
  const nodes = tops.flatMap((t) => t.nodes);
  const edges: AtlasEdge[] = tops.flatMap((t) => t.edges);
  try {
    for (const e of readMap(workspace).crossRepoEdges) {
      edges.push({ from: e.from, to: e.to, kind: "http", line: 0 });
    }
  } catch {
    /* no map yet */
  }
  return new Graph(nodes, edges);
}

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
  /** How many callers were dropped by `limit` (0 if none). */
  truncated: number;
}

export function queryImpact(
  query: string,
  workspace?: string,
  repo?: string,
  opts: { maxDepth?: number; limit?: number } = {},
): ImpactResult {
  const ws = pickWorkspace(workspace);
  const graph = buildGraph(readTopology(ws, pickRepo(ws, repo)));
  const { nodes: targets, resolvedAs } = resolveTargets(graph, query);
  const all = transitiveCallers(graph, targets.map((t) => t.id), { maxDepth: opts.maxDepth });
  const affected = new Set<string>([...targets.map((t) => t.id), ...all.map((c) => c.id)]);
  let crossRepo: CrossRepoEdge[] = [];
  try {
    crossRepo = readMap(ws).crossRepoEdges.filter((e) => affected.has(e.to));
  } catch {
    /* no map */
  }
  const { items: callers, truncated } = cap(all, opts.limit ?? DEFAULT_LIMIT);
  return { query, resolvedAs, targets, callers, crossRepo, truncated };
}

export function queryEndpoints(workspace?: string): MergedMap {
  return readMap(pickWorkspace(workspace));
}

/** The local call subgraph around a symbol (one call; depth/size-bounded). */
export function queryNeighborhood(
  symbol: string,
  workspace?: string,
  repo?: string,
  depth?: number,
): Neighborhood {
  const ws = pickWorkspace(workspace);
  const graph = buildGraph(readTopology(ws, pickRepo(ws, repo)));
  const seeds = resolveTargets(graph, symbol).nodes.map((n) => n.id);
  return neighborhood(graph, seeds, { depth: depth ?? 1 });
}

export interface PathQueryResult {
  from: string;
  to: string;
  found: boolean;
  hops: PathResult["hops"];
}

/** Shortest connection between two symbols/files across the whole workspace. */
export function queryPath(
  from: string,
  to: string,
  workspace?: string,
  maxHops?: number,
): PathQueryResult {
  const g = workspaceGraph(pickWorkspace(workspace));
  const a = resolveTargets(g, from).nodes.map((n) => n.id);
  const b = resolveTargets(g, to).nodes.map((n) => n.id);
  if (a.length === 0 || b.length === 0) return { from, to, found: false, hops: [] };
  const res = shortestPath(g, a, b, { maxHops: maxHops ?? 12 });
  return { from, to, found: !!res, hops: res?.hops ?? [] };
}
