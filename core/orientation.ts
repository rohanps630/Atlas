/**
 * Orientation aids (pure) — a deterministic "read this first" digest so an agent
 * grasps a system's shape in one cheap read instead of many exploratory calls.
 *
 * `topHubs` = functions with the most callers (a plain in-degree count — the
 * "everything depends on these" code, NOT a quality/health score).
 * `suggestedQuestions` = concrete prompts the map can answer, seeded with real
 * hubs/contracts so the agent asks scoped questions, not vague ones.
 */

import type { Graph } from "./graph.js";
import type { AtlasNode, MergedMap } from "./schema.js";

export interface Hub {
  node: AtlasNode;
  callers: number;
}

export function topHubs(graph: Graph, limit = 8): Hub[] {
  const hubs: Hub[] = [];
  for (const node of graph.nodes.values()) {
    if (node.kind !== "function") continue;
    const callers = graph.callersOf(node.id).length;
    if (callers > 0) hubs.push({ node, callers });
  }
  hubs.sort((a, b) => b.callers - a.callers || a.node.id.localeCompare(b.node.id));
  return hubs.slice(0, limit);
}

export function suggestedQuestions(hubs: Hub[], map: MergedMap): string[] {
  const qs: string[] = [];
  const hub = hubs[0]?.node.name;
  if (hub) {
    qs.push(`What breaks if I change \`${hub}\`?  → atlas impact ${hub}`);
    qs.push(`Who calls \`${hub}\`?  → atlas context ${hub}`);
  }
  const edge = map.crossRepoEdges[0];
  if (edge) {
    const consumer = nameOf(edge.from);
    const handler = nameOf(edge.to);
    qs.push(`How does \`${consumer}\` reach \`${handler}\`?  → atlas path ${consumer} ${handler}`);
  }
  if (map.externalNodes.length > 0) {
    qs.push(`Which backend endpoints does this depend on?  → atlas endpoints`);
  }
  qs.push(`What does <a file you're about to edit> connect to?  → atlas context <file>`);
  return qs;
}

function nameOf(nodeId: string): string {
  const hash = nodeId.lastIndexOf("#");
  if (hash >= 0) return nodeId.slice(hash + 1);
  const colon = nodeId.indexOf(":");
  return colon >= 0 ? nodeId.slice(colon + 1) : nodeId;
}
