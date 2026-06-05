/**
 * Visualization model + deterministic force-directed layout (ADR 0018).
 *
 * Pure and language-agnostic: turns the per-repo topologies + merged map into a
 * graph of connected nodes (isolated nodes dropped) with positions computed by a
 * seeded force simulation, so the same map always yields the same picture. The
 * CLI (`cli/viz.ts`) renders this into a self-contained HTML file.
 */

import type { ExtractorOutput, MergedMap } from "./schema.js";

export interface VizNode {
  id: string;
  label: string;
  repo: string;
  kind: string;
  degree: number;
  x: number;
  y: number;
}

export interface VizEdge {
  from: string;
  to: string;
  kind: string; // call | import | http
}

export interface VizModel {
  nodes: VizNode[];
  edges: VizEdge[];
  repos: string[];
}

export interface VizOptions {
  repo?: string; // scope to a single repo
  seed?: number;
}

/** Build the connected-graph model (isolated nodes dropped) and lay it out. */
export function buildVizModel(
  tops: ExtractorOutput[],
  map: MergedMap | undefined,
  opts: VizOptions = {},
): VizModel {
  const all = new Map<string, { id: string; label: string; repo: string; kind: string }>();
  for (const t of tops) {
    for (const n of t.nodes) {
      const repo = n.id.includes(":") ? n.id.slice(0, n.id.indexOf(":")) : t.repo;
      if (opts.repo && repo !== opts.repo) continue;
      all.set(n.id, { id: n.id, label: n.name, repo, kind: n.kind });
    }
  }

  const edges: VizEdge[] = [];
  const degree = new Map<string, number>();
  const add = (from: string, to: string, kind: string) => {
    if (from === to || !all.has(from) || !all.has(to)) return;
    edges.push({ from, to, kind });
    degree.set(from, (degree.get(from) ?? 0) + 1);
    degree.set(to, (degree.get(to) ?? 0) + 1);
  };
  for (const t of tops) for (const e of t.edges) if (e.kind === "call" || e.kind === "import") add(e.from, e.to, e.kind);
  if (map) for (const e of map.crossRepoEdges) add(e.from, e.to, "http");

  const nodes: VizNode[] = [];
  for (const n of all.values()) {
    const d = degree.get(n.id) ?? 0;
    if (d === 0) continue; // drop isolated nodes — they carry no relationships
    nodes.push({ ...n, degree: d, x: 0, y: 0 });
  }
  const kept = new Set(nodes.map((n) => n.id));
  const keptEdges = edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  const repos = [...new Set(nodes.map((n) => n.repo))].sort();

  layout(nodes, keptEdges, opts.seed ?? 0x9e3779b9);
  return { nodes, edges: keptEdges, repos };
}

/** Seeded force-directed layout (Fruchterman–Reingold style), deterministic. */
function layout(nodes: VizNode[], edges: VizEdge[], seed: number): void {
  const n = nodes.length;
  if (n === 0) return;
  const rng = mulberry32(seed);
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));

  const spread = 300 + Math.sqrt(n) * 10;
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * spread;
    nodes[i]!.x = Math.cos(a) * r;
    nodes[i]!.y = Math.sin(a) * r;
  }

  const iters = n > 4000 ? 40 : n > 1500 ? 80 : n > 500 ? 150 : 250;
  const k = 60; // ideal edge length
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    fx.fill(0);
    fy.fill(0);
    // Repulsion (O(n²) — bounded by the iteration cap above).
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i]!.x - nodes[j]!.x;
        let dy = nodes[i]!.y - nodes[j]!.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const f = (k * k) / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        fx[i]! += dx * f;
        fy[i]! += dy * f;
        fx[j]! -= dx * f;
        fy[j]! -= dy * f;
      }
    }
    // Attraction along edges.
    for (const e of edges) {
      const i = idx.get(e.from)!;
      const j = idx.get(e.to)!;
      let dx = nodes[i]!.x - nodes[j]!.x;
      let dy = nodes[i]!.y - nodes[j]!.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k;
      dx /= d;
      dy /= d;
      fx[i]! -= dx * f;
      fy[i]! -= dy * f;
      fx[j]! += dx * f;
      fy[j]! += dy * f;
    }
    // Gravity to centre + cooled integration.
    const maxStep = 30 * (1 - it / iters) + 1;
    for (let i = 0; i < n; i++) {
      fx[i]! -= nodes[i]!.x * 0.02;
      fy[i]! -= nodes[i]!.y * 0.02;
      const d = Math.sqrt(fx[i]! * fx[i]! + fy[i]! * fy[i]!) || 0.01;
      const step = Math.min(d, maxStep);
      nodes[i]!.x += (fx[i]! / d) * step;
      nodes[i]!.y += (fy[i]! / d) * step;
    }
  }
  // Round for stable, compact output.
  for (const nd of nodes) {
    nd.x = Math.round(nd.x * 10) / 10;
    nd.y = Math.round(nd.y * 10) / 10;
  }
}

/** Deterministic PRNG (so layouts are reproducible — `Math.random` isn't used). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
