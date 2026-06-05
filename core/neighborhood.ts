/**
 * Bounded neighborhood (pure) — the local call subgraph around a symbol in one
 * query, so an agent gets "what's around this" without separate callers/callees/
 * impact round-trips. Depth- and size-capped to keep token cost predictable.
 */

import type { Graph } from "./graph.js";
import type { AtlasNode } from "./schema.js";

export interface Neighborhood {
  center: AtlasNode[];
  nodes: AtlasNode[];
  edges: { from: string; to: string; kind: string }[];
  truncated: number;
}

export function neighborhood(
  graph: Graph,
  seedIds: string[],
  opts: { depth?: number; limit?: number } = {},
): Neighborhood {
  const depth = opts.depth ?? 1;
  const limit = opts.limit ?? 60;

  const center = seedIds.map((id) => graph.node(id)).filter((n): n is AtlasNode => !!n);
  const seen = new Set<string>(seedIds);
  let frontier = [...seedIds];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of [...graph.callersOf(id), ...graph.calleesOf(id)]) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        next.push(n.id);
      }
    }
    frontier = next;
  }

  const all = [...seen].map((id) => graph.node(id)).filter((n): n is AtlasNode => !!n);
  const nodes = all.slice(0, limit);
  const kept = new Set(nodes.map((n) => n.id));
  const edges = graph.edges
    .filter((e) => e.kind === "call" && kept.has(e.from) && kept.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, kind: e.kind }));

  return { center, nodes, edges, truncated: all.length - nodes.length };
}
