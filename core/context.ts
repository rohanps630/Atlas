/**
 * Context packs — the Phase 1 deliverable the agent (and I) actually read.
 *
 * Given a human-typed query (a node id, a symbol name, or a file path), resolve
 * it to one or more target nodes and, for each, gather its callers and callees.
 * Pure: takes a Graph, returns data. Formatting/printing lives in the CLI.
 */

import type { AtlasNode } from "./schema.js";
import type { Graph } from "./graph.js";

/** Context for a single resolved target node. */
export interface TargetContext {
  node: AtlasNode;
  callers: AtlasNode[];
  callees: AtlasNode[];
}

export interface ContextPack {
  /** The raw query string the user passed. */
  query: string;
  /** How the query was interpreted. */
  resolvedAs: "id" | "symbol" | "file" | "unresolved";
  /** One entry per matched target node (a file query can match several). */
  targets: TargetContext[];
}

/**
 * Resolve a query to target nodes. Tries, in order:
 *   1. exact node id (`repo:file#symbol`)
 *   2. symbol name
 *   3. file path (exact relative path or `/`-suffix match)
 */
export function resolveTargets(
  graph: Graph,
  query: string,
): { nodes: AtlasNode[]; resolvedAs: ContextPack["resolvedAs"] } {
  const byId = graph.node(query);
  if (byId) return { nodes: [byId], resolvedAs: "id" };

  const bySymbol = graph.findBySymbol(query);
  if (bySymbol.length > 0) return { nodes: bySymbol, resolvedAs: "symbol" };

  const byFile = graph.findByFile(query);
  if (byFile.length > 0) {
    // A file query is about the code in the file: prefer its functions, and
    // fall back to whatever nodes exist (e.g. the module node) if it has none.
    const fns = byFile.filter((n) => n.kind === "function");
    return { nodes: fns.length > 0 ? fns : byFile, resolvedAs: "file" };
  }

  return { nodes: [], resolvedAs: "unresolved" };
}

/** Build a context pack for a query against a graph. */
export function contextPack(graph: Graph, query: string): ContextPack {
  const { nodes, resolvedAs } = resolveTargets(graph, query);
  const targets: TargetContext[] = nodes.map((node) => ({
    node,
    callers: graph.callersOf(node.id),
    callees: graph.calleesOf(node.id),
  }));
  return { query, resolvedAs, targets };
}
