# AGENTS.md — onboarding contract for AI agents

You are an AI agent (Claude Code, Kiro, or similar) continuing development of this tool.
This file is your contract. Read it fully before writing any code.

## What this project is
A local-first tool that builds a **structured, cross-repo map of a software system** and
serves it to coding agents. It does **not** do semantic search or embeddings — the agent
(you) does in-repo discovery; this tool provides the cross-repo structure you can't cheaply
derive. Full rationale: `README.md`, then `docs/`.

## Read these first, in order
1. `docs/vision.md` — the owner's plan and the scenarios the tool must serve.
2. `docs/philosophy.md` — the 10 principles that resolve every trade-off.
3. `docs/phases.md` — find the current phase; build the next deliverable, nothing more.
4. `docs/schema.md` — the data contract. **Treat it as a public API.**
5. `docs/adr/` — why each decision was made.
6. `docs/rejected.md` — what is deliberately out of scope.

## Rules you must follow
1. **Stay in the current phase.** Find the 🚧 phase in `docs/phases.md`. Do not jump ahead or
   add features from later phases or from `rejected.md`.
2. **Never re-add a rejected idea** (embeddings, health scoring, audits, etc.) without first
   writing an ADR that supersedes the original and names the real problem it solves.
3. **Honor the schema.** If you must change it, bump `schemaVersion`, update `docs/schema.md`,
   add a `CHANGELOG.md` entry, and prefer additive changes.
4. **Respect the extractor/core boundary** (ADR 0005). Language-specific code goes in an
   extractor; the core only consumes normalized JSON.
5. **Keep it local** (ADR 0006). No network calls in the analysis pipeline.
6. **Never modify target repos.** They are read-only, referenced by path in the manifest.
   Generated data goes to the data store (`~/.atlas/`), never into this repo.
7. **Dogfood.** Every change should keep the tool runnable on a real repo. Small and working
   beats large and theoretical (philosophy #10).

## How to propose a significant change
Write a new ADR in `docs/adr/` (next number, `Proposed` status) describing context, decision,
and consequences. Link it from `docs/adr/README.md`. Only then implement.

## Current state
Phases 1 and 2 are complete and dogfooded on `ghost_daddy`. Shipped: TypeScript build/test
toolchain; the ts-morph extractor (functions, module nodes, import/call edges, `consumes` +
`exposes`); a pure `core` (graph, cross-repo linker, impact); per-workspace data store with a
manifest; and commands `scan`, `context`, `endpoints`, `impact`. Cross-repo resolution is
verified by the `fixtures/cross` FE+BE pair (a missing repo degrades to `external` and
resolves when added).

Phase 3 is also built: `atlas mcp` (MCP server exposing `context`/`callers`/`impact`/
`endpoints` over stdio, read-only, no network) and `atlas agent` (generates `architecture.md`
+ `atlas.steering.md` into the data store and prints Claude Code / Cursor / Kiro wiring).
Generated artifacts stay in `~/.atlas/<ws>/`; only a one-line import goes into a target repo's
CLAUDE.md, added by the owner.

Phase 4 is in progress: Swift + Kotlin (tree-sitter, ADR 0008) and Go with chi route
extraction (ADR 0010) run automatically during `scan`/`refresh` and merge into the repo's
topology, so `context`/`impact`/endpoints and the MCP server cover native + Go too.
The Kotlin extractor also emits Retrofit `consumes` (ADR 0011). `cli/extract.ts` orchestrates
the per-repo, multi-language extraction. Verified polyglot linking: the HMS workspace spans 3
repos / 3 languages — Next.js (TS) + Android (Kotlin/Retrofit) both link to the Go/chi backend
(21 cross-repo contracts).

Stack detection (ADR 0009, `cli/detect.ts`) infers languages, frameworks, role, and type
from deps/config/structure; `scan` auto-fills `--role`/`--type` (overridable) and the agent
docs include the detected stack. `atlas detect <repo>` prints the inference. Detection selects
extractors + context only — never workflows (ADR 0002).

**Next:** add further language extractors (Python via `ast`, Java) one at a time, only when a
real service needs one — each emits the same normalized JSON; the core is untouched (ADR 0005).
Do not build any Phase 5 audit/report feature without a superseding ADR (see docs/rejected.md).

Build/run: `npm install && npm run build`, then
`node bin/atlas.js <scan|context|endpoints|impact|agent|mcp|refresh>`. Tests: `npm test`.

## Conventions
- CLI entry: `bin/atlas.js` (stub). Commands route to `cli/`.
- Keep functions small and the core pure (no I/O in graph logic where avoidable — easier to test).
- Tests live next to the core; test the core hard, extractors lightly (they churn).
