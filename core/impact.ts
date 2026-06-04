/**
 * Impact analysis (core, pure — ADR 0005).
 *
 * "If I change X, what else might break?" Within a repo that is the set of
 * functions that transitively call X (reverse reachability over `call` edges).
 * The cross-repo half — which other repos consume an endpoint X handles — is
 * layered on top in the CLI using the merged map, so this stays graph-only.
 */

import type { AtlasNode } from "./schema.js";
import type { Graph } from "./graph.js";

/**
 * All nodes that transitively call any of `seedIds` (the blast radius of a
 * change). Seeds themselves are excluded. Order is breadth-first from the seeds.
 */
export function transitiveCallers(graph: Graph, seedIds: string[]): AtlasNode[] {
  const seeds = new Set(seedIds);
  const seen = new Set<string>(seeds);
  const out: AtlasNode[] = [];
  let frontier = [...seedIds];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const caller of graph.callersOf(id)) {
        if (seen.has(caller.id)) continue;
        seen.add(caller.id);
        out.push(caller);
        next.push(caller.id);
      }
    }
    frontier = next;
  }
  return out;
}
