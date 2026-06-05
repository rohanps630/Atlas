/**
 * Shortest-path search over the workspace graph (pure — ADR 0005).
 *
 * Answers "how does A connect to B" in one query instead of the agent reading
 * files. Walks the union of `call` edges and cross-repo `http` contract edges
 * (and `import` edges) as an undirected graph, but reports each hop's real
 * direction and kind, so a path can cross repos and languages (FE call →
 * HTTP contract → BE handler). Breadth-first ⇒ fewest hops.
 */

import type { AtlasNode } from "./schema.js";
import type { Graph } from "./graph.js";

export type HopDirection = "calls" | "called-by" | "to" | "from";

export interface PathHop {
  node: AtlasNode;
  /** How we arrived from the previous hop (absent for the start node). */
  via?: { kind: string; direction: HopDirection };
}

export interface PathResult {
  hops: PathHop[];
}

export function shortestPath(
  graph: Graph,
  fromIds: string[],
  toIds: string[],
  opts: { maxHops?: number } = {},
): PathResult | null {
  const maxHops = opts.maxHops ?? 12;
  const goals = new Set(toIds);
  if (fromIds.some((id) => goals.has(id))) {
    const n = graph.node(fromIds.find((id) => goals.has(id))!);
    return n ? { hops: [{ node: n }] } : null;
  }

  // Undirected adjacency that remembers each edge's direction + kind.
  const adj = new Map<string, { to: string; kind: string; forward: boolean }[]>();
  const add = (a: string, b: string, kind: string, forward: boolean) => {
    let list = adj.get(a);
    if (!list) adj.set(a, (list = []));
    list.push({ to: b, kind, forward });
  };
  for (const e of graph.edges) {
    add(e.from, e.to, e.kind, true);
    add(e.to, e.from, e.kind, false);
  }

  const prev = new Map<string, { from: string; kind: string; forward: boolean }>();
  const seen = new Set<string>(fromIds);
  let frontier = [...fromIds];
  let depth = 0;
  let hit: string | undefined;

  outer: while (frontier.length > 0 && depth < maxHops) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of adj.get(id) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        prev.set(edge.to, { from: id, kind: edge.kind, forward: edge.forward });
        if (goals.has(edge.to)) {
          hit = edge.to;
          break outer;
        }
        next.push(edge.to);
      }
    }
    frontier = next;
    depth++;
  }

  if (!hit) return null;

  // Reconstruct from the goal back to a source.
  const chain: string[] = [];
  for (let cur: string | undefined = hit; cur; cur = prev.get(cur)?.from) {
    chain.push(cur);
    if (fromIds.includes(cur)) break;
  }
  chain.reverse();

  const hops: PathHop[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = graph.node(chain[i]!);
    if (!node) return null;
    if (i === 0) {
      hops.push({ node });
    } else {
      const step = prev.get(chain[i]!)!;
      hops.push({ node, via: { kind: step.kind, direction: directionLabel(step.kind, step.forward) } });
    }
  }
  return { hops };
}

function directionLabel(kind: string, forward: boolean): HopDirection {
  if (kind === "call") return forward ? "calls" : "called-by";
  return forward ? "to" : "from";
}
