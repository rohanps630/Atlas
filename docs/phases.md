# Phases — the roadmap

Each phase is small, ends in something runnable and dogfooded, and is built to be picked up
by an AI agent (Claude Code / Kiro). Don't start a phase before the previous one is *used*.

Legend: ✅ done · 🚧 in progress · ⬜ not started

---

## Phase 0 — Foundation ✅ (built by Claude)

**Goal:** a documented, scaffolded, agent-ready repo so any agent can continue development.

**Deliverables**
- Full doc set: vision, philosophy, this roadmap, schema, ADRs, rejected-ideas.
- `AGENTS.md` onboarding contract.
- Repo skeleton: `core/`, `extractors/typescript/`, `cli/`, `mcp/`, `fixtures/`, `bin/`.
- Runnable CLI stub (`node bin/atlas.js --help` / `status`).
- The keystone data schema (v0) documented as a contract.

**Done criteria:** the CLI stub runs; an agent can read the docs and know exactly what to
build next without further explanation.

---

## Phase 1 — Single-repo core ✅ (the first *useful* version)

**Goal:** scan one TypeScript repo and produce one thing I read while working.

**Deliverables**
- Real toolchain decision executed (migrate the stub to TypeScript; set up build + test).
- `extractors/typescript`: parse a repo into the normalized node/edge schema using the
  TypeScript Compiler API (or ts-morph). Minimal: functions, imports, calls.
- `core`: build an intra-repo graph from extractor output.
- `atlas context <symbol|file>`: emit a focused context pack (the thing + callers + callees).
- `atlas scan <repo>`: write topology to the data store.

**Done criteria:** I run `atlas context` on a real repo and actually use the output. **Dogfood
within the first week or the project is not alive.**

**Met:** dogfooded on `ghost_daddy` (~266-file Expo/RN app); owner confirmed the context
packs are useful in real work.

---

## Phase 2 — Multi-repo & cross-repo links ✅

**Goal:** make the map span repos and degrade gracefully when repos are missing.

**Deliverables**
- Manifest format + central data store at `~/.atlas/` (see `schema.md`).
- Endpoint extraction: FE `consumes`, BE `exposes` (method + normalized path).
- Cross-repo linker: match `consumes` ↔ `exposes`; unmatched → `external` node.
- `atlas impact <target>`: "change this → these repos/symbols are affected," across repos.

**Done criteria:** on a 2+ repo setup, `atlas impact` correctly lists downstream consumers,
and a missing repo shows up as `external`, not an error.

**Met:** `consumes`/`exposes` extraction, the contract linker, `atlas endpoints`, and
`atlas impact` are built. Dogfooded on `ghost_daddy` (freelance/partial-access: 29 external
backend endpoints surfaced, no errors; `impact` lists intra-repo blast radius). Cross-repo
resolution proven on the `fixtures/cross` FE+BE pair: a missing repo shows as `external`,
and adding it resolves the edge automatically.

---

## Phase 3 — Expose the map to agents ✅

**Goal:** let Claude Code / Kiro query the map on demand instead of reading files.

**Deliverables**
- `mcp/`: an MCP server exposing `context`, `callers`, `impact`, `endpoints`.
- A greppable `architecture.md` / `topology.json` the agent can also just read.
- A steering/patterns file (project conventions extracted from real code) — the "always-on"
  context for the agent. This is the surviving piece of the old "patterns file" idea.

**Done criteria:** an agent answers a cross-repo question by calling the MCP server.

**Met:** `atlas mcp` serves `context`/`callers`/`impact`/`endpoints` over stdio (verified by an
MCP client). `atlas agent` generates `architecture.md` + `atlas.steering.md` into the data
store and prints the Claude Code / Cursor / Kiro wiring. Wiring a real repo (one import line +
`claude mcp add`) is the owner's step — it edits the target repo, so it's not done automatically.

---

## Phase 4 — More languages 🚧 (in progress)

**Goal:** support the actual languages of my real services.

**Deliverables**
- Add extractors (Go via `go list`, Python via `ast`, Java if needed) — one at a time, only
  when a real service needs it. Each emits the same normalized JSON; the core is untouched.

**Done criteria:** a polyglot company manifest produces one unified cross-repo map.

**Done so far:** Swift + Kotlin extractors via tree-sitter (ADR 0008), driven by a real need
(RN native modules in the dogfood repo). A single repo now yields one unified map across
TypeScript + Swift + Kotlin — 721 functions on ghost_daddy, native call graphs included, the
core untouched (ADR 0005). Go/Python/Java remain earn-it: add each only when a real service
needs it, the same way.

---

## Phase 5 — Audits & reports ⬜ (earn it)

**Goal:** *only if a real problem appears*, add on-demand audits.

**Candidates (all currently deferred — see `rejected.md`):** API drift report, env-var audit,
dependency freshness, dead-code, health scoring.

**Rule:** do not build any of these speculatively. Each requires an ADR that names the actual
recurring problem it solves. Most "platform" features die here on purpose.
