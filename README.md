# Atlas

**A local-first, polyglot code-intelligence tool that gives AI coding agents the one thing
they can't cheaply discover on their own: a structured map of a whole system across
repositories.**

> Status: **v0.1.0** — Phases 1–3 complete, Phase 4 in progress. Multi-repo workspaces,
> FE↔backend contract linking, cross-repo impact/path queries, an MCP server + steering for
> agents, automatic stack detection, and a conventions/landmines surface. Extracts
> **TypeScript/JavaScript, Swift, Kotlin, and Go** into one map. See [`docs/phases.md`](docs/phases.md).

The agent brings the search; **Atlas brings the map.**

---

## Contents
- [Why Atlas](#why-atlas)
- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [Core concepts](#core-concepts)
- [Commands](#commands)
- [Supported languages](#supported-languages)
- [Agent integration](#agent-integration)
- [Sharing & cross-platform](#sharing--cross-platform)
- [Project structure](#project-structure)
- [Design principles](#design-principles--what-atlas-is-not)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

---

## Why Atlas

Modern coding agents (Claude Code, Cursor, Kiro, …) are excellent at *searching within a repo*
on demand — grep, glob, read. They are weak at *seeing the shape of a whole system* spread
across many repositories. Atlas does **not** try to out-search the agent. It builds the
structural map the agent can't cheaply reconstruct:

- **who calls whom** (the call graph, within and across repos),
- **which frontend calls map to which backend endpoints** (HTTP contract links), and
- **what breaks if you change a given thing** (impact, across repos and languages).

It serves that map to the agent over MCP and as always-on context — so the agent stops burning
tokens re-deriving structure by reading files, and makes fewer mistakes because it can see the
blast radius and the conventions before it edits.

**The one decision that shapes everything:** *agentic search over embeddings.* No vector DB, no
semantic index, no LLM in the pipeline. Atlas answers graph questions with **exact** answers,
entirely on your machine. (See [ADR 0001](docs/adr/0001-agentic-search-over-embeddings.md).)

## Features

- **Polyglot extraction** — TypeScript/JavaScript (via the TS compiler/ts-morph), Swift, Kotlin,
  and Go (via tree-sitter), all normalized to one schema and merged per repo.
- **Cross-repo contract linking** — matches frontend `consumes` (HTTP client calls) to backend
  `exposes` (route handlers) by method + normalized path; unmatched calls become first-class
  `external` nodes (the "backends you depend on but don't have").
- **Graph queries** — `context` (callers + callees), `impact` (transitive callers + cross-repo
  consumers, depth/size-bounded), `path` (shortest connection between any two symbols across
  repos), `neighborhood` (bounded local subgraph), `endpoints` (the whole HTTP surface).
- **Automatic stack detection** — infers languages, frameworks, role (fe/be/lib/tool), and
  workspace type from manifests/config/build files; `scan` auto-configures itself.
- **Agent surface** — an MCP server (6 read-only tools), an always-on steering file, and a
  generated `architecture.md` containing an orientation digest (dependency hubs + suggested
  questions), **conventions** (per-layer naming + the exemplar file to copy), **landmines**
  (TODO/FIXME/HACK/WHY), a Mermaid system diagram, and the external-dependency list.
- **Multi-repo workspaces** — the same tool works at 1 repo or 20+; only the manifest differs.
- **Freshness without magic** — `atlas refresh` re-builds a workspace in seconds; an optional
  git hook does it on commit. The map is always a *hint to verify*, never authority.
- **Friendly UX** — a `status` dashboard and an interactive numbered `menu`.
- **Local-first & private** — no network calls in the analysis pipeline; nothing leaves your
  machine; no stored copy of your code to leak. Safe to point at NDA'd client code.

## How it works

```
        detect              extract (per language)            merge / link              serve
repo ─▶ languages,   ─▶ ts-morph (TS/JS) ─┐            ┌▶ one graph per repo  ─▶ CLI: context/impact/path/…
        frameworks,      tree-sitter      │  normalized│  + cross-repo HTTP        MCP server (6 tools)
        role, type       (Swift/Kotlin/Go)┴─ JSON  ────┴  contract edges           architecture.md + steering
                                            (schema §2)    external nodes for
                                                           unmatched consumes
```

Per-language **extractors** read source and emit one normalized JSON shape. The
language-agnostic **core** consumes only that JSON — it builds the graph, links repos by HTTP
contract, and answers queries. Adding a language never touches the core
([ADR 0005](docs/adr/0005-extractor-core-boundary.md)). Full overview:
[`docs/how-it-works.md`](docs/how-it-works.md).

## Requirements

- **Node.js ≥ 18** (developed on 22) — macOS, Linux, or Windows.
- A **C/C++ toolchain + Python** for the native tree-sitter grammars (compiled on install):
  - macOS: `xcode-select --install`
  - Linux: `build-essential python3`
  - Windows: Visual Studio Build Tools ("Desktop development with C++") + Python 3
- Optional: **Claude Code** (or any MCP client) for the agent integration.

## Installation

```bash
git clone https://github.com/rohanps630/Atlas.git
cd Atlas
npm install        # builds the tree-sitter grammars (needs the toolchain above)
npm run build
npm test           # optional sanity check — should be all green
npm link           # optional: makes `atlas` available globally
```

Without `npm link`, run commands as `node bin/atlas.js <command>`. The rest of this README uses
the global `atlas` form. New machine? See [`docs/setup.md`](docs/setup.md).

## Quickstart

```bash
# 1. Scan a repo into a workspace (stack auto-detected; no flags needed)
atlas scan /path/to/frontend -w myapp

# 2. Add the backend to the same workspace → cross-repo links light up
atlas scan /path/to/backend -w myapp

# 3. Ask the map
atlas status                         # dashboard: workspaces, repos, counts, freshness
atlas context createOrder -w myapp   # a symbol + its callers + callees
atlas impact createOrder -w myapp    # what breaks (transitive + cross-repo)
atlas path LoginScreen LoginHandler -w myapp   # how does A reach B (across repos)
atlas endpoints -w myapp             # cross-repo links + external (missing) backends
atlas menu                           # or just run `atlas` — interactive menu
```

With a single workspace, `-w` is optional; with a single repo in it, `--repo` is too.

## Core concepts

- **Workspace** — a named scope holding one or more repos and their generated data, at
  `~/.atlas/<workspace>/` (override the root with `ATLAS_HOME`). One per project/system.
- **The map is a hint.** Generated topology can drift from source; treat it as a guide to
  verify against real code, not authority. Cheap to regenerate beats trusted-but-stale.
- **Three separate locations** ([ADR 0003](docs/adr/0003-three-location-architecture.md)):
  the **tool repo** (this), the **data store** (`~/.atlas`, never committed), and your
  **target repos** (read-only, referenced by path — never modified).

## Commands

| Command | What it does |
|---|---|
| `atlas` / `atlas menu` | Interactive numbered menu (friendly mode) |
| `atlas status [ws]` | Dashboard: workspaces, repos, counts, freshness, wiring |
| `atlas detect <path>` | Infer a repo's languages, frameworks, and role (no scan) |
| `atlas scan <path>` | Extract a repo into a workspace, then re-link |
| `atlas context <symbol\|file>` | Target + its callers and callees |
| `atlas impact <symbol\|file>` | Transitive callers + cross-repo consumers (`--depth`/`--limit`); `--diff` for a git change's blast radius |
| `atlas path <A> <B>` | Shortest connection between two symbols (cross-repo) |
| `atlas endpoints` | Cross-repo links + external (unmatched) endpoints |
| `atlas viz` | Interactive, self-contained HTML map of the workspace graph |
| `atlas agent` | Generate steering + `architecture.md`; print wiring |
| `atlas refresh` | Re-scan a whole workspace, re-link, regenerate agent docs |
| `atlas mcp` | Run the MCP server (stdio) for agents |
| `atlas hook <install\|uninstall\|search-nudge>` | Git auto-refresh / search-nudge hooks |

Every flag, output, and exit code: [`docs/cli.md`](docs/cli.md).

## Supported languages

| Language | Nodes & edges | HTTP endpoints |
|---|---|---|
| TypeScript / JavaScript | functions, modules, imports, calls | `consumes` (fetch / axios / client calls) · `exposes` (Express incl. mounted-router prefixes, NestJS decorators) |
| Go | functions, methods, calls | `exposes` (chi routes, incl. nested + const base paths) |
| Kotlin | functions, methods, calls | `consumes` (Retrofit annotations) |
| Swift | functions, methods, calls | — |

Adding a language is one registry entry for the generic tree-sitter extractor (or a dedicated
extractor for framework-specific endpoint extraction) — the core is untouched. See
[`extractors/README.md`](extractors/README.md). New languages are added **only when a real
service needs one.**

## Agent integration

Make a coding agent use Atlas automatically — without you mentioning it each time:

```bash
atlas agent -w myapp            # generate steering + architecture.md, print wiring
# register the MCP server once (user scope = available in every project):
claude mcp add atlas -s user -- node /abs/path/to/Atlas/bin/atlas.js mcp
```

This gives the agent:
- **MCP tools** — `atlas_context`, `atlas_callers`, `atlas_impact`, `atlas_endpoints`,
  `atlas_path`, `atlas_neighborhood` (read-only, no network).
- **Steering** — `~/.atlas/<ws>/atlas.steering.md`, imported into a repo's `CLAUDE.md`, telling
  the agent what Atlas is, when to use it, and to treat it as a hint to verify.
- **`architecture.md`** — orientation digest, conventions/golden-files, landmines, a Mermaid
  diagram, and the external-dependency list.
- *(Optional)* a **search-nudge** PreToolUse hook (`atlas hook search-nudge`) that reminds the
  agent to query Atlas before raw grep, and a **git auto-refresh** hook
  (`atlas hook install`) that rebuilds the map on commit.

## Sharing & cross-platform

Atlas runs on **macOS, Linux, and Windows** (pure Node/TypeScript; native grammars compile per
OS). You can't share the *map* as a file — it's generated from each person's local repo paths
and served by their own MCP server. So **sharing = sharing the tool + the code repos via git**;
each person sets Atlas up locally and scans their checkout. Commit only **portable** wiring (the
path-free Atlas note in `CLAUDE.md`); keep machine-specific imports in a gitignored
`CLAUDE.local.md`. Full guide: [`docs/setup.md`](docs/setup.md).

## Project structure

```
Atlas/
├── bin/atlas.js          # CLI entry — routes commands to compiled dist/
├── core/                 # language-agnostic engine (graph, linker, impact, path, …) + tests
├── extractors/
│   ├── typescript/       # ts-morph extractor
│   ├── native/           # generic tree-sitter extractor (Swift, Kotlin) + registry
│   └── go/               # tree-sitter Go extractor (chi routes)
├── cli/                  # command implementations (scan, context, impact, status, menu, …)
├── mcp/                  # MCP server
├── fixtures/             # tiny sample repos for tests
├── docs/                 # vision, philosophy, phases, schema, ADRs, how-it-works, cli, setup
└── AGENTS.md             # onboarding contract for contributors / AI agents
```

## Design principles / what Atlas is *not*

Atlas is deliberately sharp. It does **not** do, and will not add without a superseding ADR
naming a real recurring problem (see [`docs/rejected.md`](docs/rejected.md)):

- ❌ embeddings / vector DB / semantic search — agents do in-repo search themselves; embeddings
  never solved the cross-repo problem (ADR 0001).
- ❌ any network call in the analysis pipeline — local-only, NDA-safe (ADR 0006).
- ❌ whole-repo "context dumps" — Atlas serves a queryable map, not a pile of files.
- ❌ health scores, speculative audits, or auto-catalogs that go stale and mislead.

Everything is resolved against the 10 principles in [`docs/philosophy.md`](docs/philosophy.md).

## Documentation

Read in this order:

1. [`docs/vision.md`](docs/vision.md) — what this is for and where it's going.
2. [`docs/philosophy.md`](docs/philosophy.md) — the principles that decide every trade-off.
3. [`docs/phases.md`](docs/phases.md) — the roadmap, phase by phase.
4. [`docs/schema.md`](docs/schema.md) — the keystone data contract (a versioned public API).
5. [`docs/adr/`](docs/adr/) — why each major decision was made.
6. [`docs/rejected.md`](docs/rejected.md) — what was deliberately *not* built, and why.
7. [`docs/backlog.md`](docs/backlog.md) — salvaged-but-not-yet-earned ideas (build when a real need appears).
8. [`docs/how-it-works.md`](docs/how-it-works.md) — the end-to-end pipeline.
9. [`docs/cli.md`](docs/cli.md) — the full command reference.
10. [`docs/setup.md`](docs/setup.md) — installing & sharing across machines/OSes.

## Development

```bash
npm run build       # compile TypeScript → dist/
npm test            # core + extractor tests (node:test via tsx)
npm run typecheck   # tsc --noEmit
```

The **core** is the most-tested, most-stable part (pure, no I/O where avoidable); extractors are
tested lightly because they churn. If you (or an AI agent) are continuing development, start with
**[`AGENTS.md`](AGENTS.md)** — the onboarding contract, including the rules that keep scope sharp.

## License

[MIT](LICENSE) © 2026 Rohan P Suresh — use, modify, and share freely; keep the copyright notice.
