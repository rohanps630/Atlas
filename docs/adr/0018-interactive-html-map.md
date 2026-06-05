# 0018 - Interactive HTML map (`atlas viz`)

Status: Accepted

## Context
`atlas agent` embeds a **static Mermaid** system diagram (repos + cross-repo contracts) in
`architecture.md`. It's great for a few repos but unreadable once a workspace is large or you want
to explore the *call* graph, not just the repo-level wiring. The predecessor system shipped an
interactive force-layout HTML visualizer (`visualizer.js` + `force-layout.js`) — pure and
deterministic, no LLM. That capability is on-thesis (rendering the exact map we already have) and
worth bringing over, cleanly.

## Update (post-merge)
Defaulting to the full **function** call graph proved an unreadable hairball on a real workspace
(hms: 1600+ nodes, overlapping labels). The default is now the **system** level — one node per
repo + per external endpoint, with aggregated cross-repo contract edges (a handful of nodes, the
architecture at a glance). The dense call graph is kept as an explicit drill-down: `--calls` for
the whole workspace, or `--repo <id>` for one repo, with labels shown only on hover (not all at
once). The rest of this ADR describes the original mechanism, which the `calls` level still uses.

## Decision
Add `atlas viz [-w <ws>] [--calls] [--repo <id>] [--out <file>]`: render the workspace's merged map
to a **self-contained** interactive HTML force-directed graph.

- **Model** (pure, `core/viz.ts`): nodes = every node that participates in an edge (isolated nodes
  are dropped — they carry no relationships); edges = intra-repo `call`/`import` + cross-repo
  `http`. Each node tagged with its repo (the id prefix), labelled by name, sized by degree.
- **Layout** computed locally and **deterministically** (a seeded PRNG + a fixed number of
  force-directed iterations, capped for large graphs) — same map ⇒ same picture. No client-side
  simulation needed.
- **Output**: one HTML file with the data + a small inline canvas renderer (pan, zoom, hover
  tooltip, repo-colour legend, search-highlight). **No CDN, no network** — everything is inlined,
  so it opens offline and is NDA-safe (ADR 0006). Written to `~/.atlas/<ws>/graph.html` by default
  (generated data, ADR 0003), or `--out`. `--repo` scopes to one repo's graph.

No schema change, no new analysis — `viz` is a pure renderer of `map.json` + the per-repo
topologies, so the core stays untouched (ADR 0005).

## Consequences
- A navigable view of large maps the static Mermaid diagram can't serve; deterministic and fully
  offline.
- Presentation-only: it adds no analysis and changes no contract, so it carries no thesis risk —
  it's the exact graph, drawn.
- Bounded for scale by dropping isolated nodes and capping layout iterations; a very large, dense
  workspace may still be busy (it's a map to explore, not a precise schematic — #5). `--repo`
  narrows it.
- It's the *map* drawn, not a new truth: like everything generated, treat it as a hint to verify.
