# Backlog — salvaged-but-not-yet-earned ideas

Ideas worth building **when a real service needs them** (philosophy #10 — small and dogfooded;
rejected.md — add features only when a real problem appears). This is distinct from:
- [`rejected.md`](rejected.md) — ideas we will **not** build (re-adding needs a superseding ADR);
- [`phases.md`](phases.md) — the **committed** roadmap.

Several of these are salvaged from the predecessor system (`graphify` + `workspace-intel`, the
Kiro/Moleculer/Sequelize setup Atlas was distilled from). They are recorded here so the *good*
structural ideas aren't lost — while the predecessor's rejected pile (health scores, dead-code,
API-drift, env-audit, dep-freshness, LLM/GraphRAG in the pipeline) stays out (see rejected.md).
Each entry: what it is, why it's on-thesis, the trigger that earns it, and the predecessor file to
crib from.

| Idea | Why it's on-thesis | Earn-it trigger | Reference |
|------|--------------------|-----------------|-----------|
| **Data-layer / shared-table topology** — parse ORM models → DB tables; record which repos read/write which tables; surface *shared tables* as cross-repo coupling. | Pure structural, exact, local — a real cross-repo coupling that HTTP-contract linking can't see (two services bound through one table). Extends principle #4 (the unknown is a node) to data. | A real ORM-backed service (Sequelize/Prisma/GORM/JPA) in a workspace where shared-table coupling actually bites. | `scripts/lib/database-topology.js`, `sequelize-parser.js` |
| **Message-broker / RPC contracts** — the non-HTTP analog of `consumes`/`exposes`: broker action calls (`ctx.call("v1.svc.action")`, gRPC, NATS) as cross-repo contract edges. | Extends cross-repo linking (the core value, philosophy #4/#6) to broker systems; exact, name-keyed, no fuzziness. The linker already matches contracts. | A real broker-based service (Moleculer/gRPC/NATS) in a scanned workspace. | `scripts/lib/moleculer-parser.js`, `service-topology.js` |
| **Diff-driven impact (`atlas impact --diff`)** — read a git diff, map changed symbols/files to nodes, report the transitive + cross-repo blast radius. | Deterministic, reuses the existing impact engine; no new analysis kind — just a CLI/CI front-end. Pairs with the existing git hooks / search-nudge. | Wanting blast-radius in PR/CI review (a recurring ask). | `scripts/lib/pr-impact.js` |
| **Interactive HTML map (`atlas viz`)** — render the merged `map.json` to a self-contained, force-layout HTML graph (filter, search, click-through), beyond the static Mermaid diagram. | Pure/deterministic rendering of data we already have — no LLM, no network. Better UX once a map is too big for Mermaid. | A real workspace (≈20+ repos) where the Mermaid diagram stops being readable. | `scripts/lib/visualizer.js`, `force-layout.js` |

## Already covered by Atlas (no action — listed so we don't "re-salvage")
- **Service / API topology** → normalized extractors + the cross-repo linker (`core/link.ts`).
- **Call-chain tracing** → `atlas path` (shortest connection, cross-repo). The predecessor's
  full-flow tracer is a depth-bounded walk; `path` covers the core need.
- **Context packs** → `atlas context` / `atlas neighborhood` / generated `architecture.md`.
- **Natural-language query / explain** → the **agent over MCP**: you ask Claude in plain English,
  it calls the exact `atlas_*` tools and phrases the answer. No LLM inside Atlas (see below).
- **Incremental / reindex** → `atlas refresh` + the optional git hook.

## On the predecessor's LLM features (graphify query/explain, GraphRAG, semantic extraction)
Recorded decision (see also ADR 0001, ADR 0006, philosophy #1/#2): **the LLM stays an optional
*consumer* of the exact map (the coding agent, over MCP) — never a part of the analysis pipeline.**
That already gives the "works with an LLM, still works without it" behavior the predecessor's
`graphify query` had: with Claude Code connected you get natural-language Q&A over the map; without
it, the CLI still answers exactly. Putting an LLM/embedding index *inside* Atlas's build/analysis —
even "optionally" — would break local-first / no-network / NDA-safe (ADR 0006), add a fuzzy second
source of truth (philosophy #2/#5), and double maintenance for a rarely-tested path. If "find by
concept via the agent" ever proves genuinely insufficient (ADR 0001's revisit condition), that
needs a **superseding ADR** for an *optional, local-only* embedding index — off by default, never
in the NDA-safe path — not a quiet feature flag.
