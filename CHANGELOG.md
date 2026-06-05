# Changelog

Schema changes must be recorded here (see docs/schema.md).

## [0.1.0] — 2026-06-05

First tagged checkpoint. Phases 1–3 complete and Phase 4 in progress: a local-first,
polyglot (TypeScript, Swift, Kotlin, Go) cross-repo map with contract linking, impact and
path queries, an MCP server + steering for agents, auto-detection, and a conventions/landmines
surface. Dogfooded on ghost_daddy and the 5-repo HMS system. Schema is v0; the core
(graph/linker/impact/path) never depends on any language. The sections below are the detailed
history that rolls up into this release.

## [Unreleased] — viz rebuilt on Cytoscape (compound drill-down, ADR 0018)

- The hand-rolled canvas viz (a flat force graph) wasn't readable — a 1600-node hairball, then an
  oversized-circle system view. Rebuilt `atlas viz` on **Cytoscape.js + fcose + expand-collapse**,
  all **vendored under `cli/vendor/` and inlined** (no CDN — still offline / NDA-safe, ADR 0006).
- Now a **compound hierarchy you click to drill into**: repo → module (directory) → function. The
  top level is just the repos, joined by **one weighted arrow per repo pair** labelled with the
  contract count (click it to list the contracts); click a repo to expand into modules, then
  functions. Expand/Collapse-all + search. `core/viz.ts` builds the Cytoscape model
  (`buildCyModel`); no schema/core-engine change.
- Verified by rendering the generated HTML in **headless Chrome** (the only true check) — which
  caught a real load-time crash: the extensions auto-register as `<script>` tags, so the explicit
  `cytoscape.use()` calls are now guarded. Dogfooded on HMS (mobile →14→ backend, admin →7→
  backend reads at a glance). Model unit-tested; 65/65.

## [Unreleased] — Diff-driven impact + interactive HTML map (ADR 0017, 0018)

Two on-thesis features salvaged from the predecessor system (see `docs/backlog.md`), both pure
front-ends over data Atlas already has — no schema change, core untouched (ADR 0005).

- **`atlas impact --diff [--base <ref>] [--repo <id>]`** (ADR 0017): the blast radius of a whole
  change. Reads `git diff <base>` (default `HEAD`), maps changed line ranges to the functions that
  own them (`[fn start, next fn start)`), and runs the existing transitive-caller + cross-repo
  impact over all of them. Dogfooded on HMS: a router/middleware change in the Go backend traced
  straight to the **Kotlin mobile app's Retrofit endpoints** it affects. Git is invoked read-only;
  no network (ADR 0006). The pure diff→nodes mapper is unit-tested without git.
- **`atlas viz [--calls] [--repo <id>] [--out <file>]`** (ADR 0018): a self-contained, interactive
  HTML force-graph of the workspace. **Default is the readable system level** — one node per repo +
  per external endpoint, with aggregated cross-repo contract edges (hover an edge to list its
  contracts). `--calls` / `--repo` draw the dense function call graph for drill-down, with labels
  on hover so it stays legible. (The first cut defaulted to the full 1600-node call graph, which
  was an unreadable hairball on HMS; corrected to the system level.) Deterministic seeded layout
  (`core/viz.ts`), no CDN/network — opens offline, NDA-safe. Model + both levels are unit-tested.
- New `docs/backlog.md` records the remaining salvaged-but-not-yet-earned ideas (data-layer/
  shared-table topology, message-broker contracts) and the standing decision that the LLM stays an
  optional *consumer* of the map (the agent over MCP), never in the analysis pipeline.

## [Unreleased] — Native (Kotlin/Swift) receiver typing (ADR 0016)

- No schema change; core untouched (ADR 0005). Native extractor (Swift + Kotlin).
- Extends receiver typing (ADR 0012) with two sources the native extractor previously ignored:
  **function-parameter types** (`fun f(x: T)` / `func f(x: T)` → `x : T`) and **class
  field/property types** (stored properties + Kotlin constructor `val/var` params → a per-class
  field→type map, looked up when a receiver identifier isn't a local binding). Both resolve
  `x.method()` to the precise `Type.method`.
- **External-receiver classification** (mirror ADR 0015): a receiver typed to a non-repo class
  (`String`, `Context`, …) is counted `external` and not run through the global short-name
  fallback — also removing wrong edges (a `ctx.foo()` linking to a coincidentally-unique repo
  method). The grammars share the relevant node names, so the logic is one path for both langs.
- **Measured (big Kotlin win):** hms-mobile (Kotlin) **59% → 85%** coverage, call edges
  **1601 → 2277 (+676)** — `impact`/`path` on the Android app are far more complete. Swift, on
  the only Swift in a workspace (`ghost_daddy`, a small RN native-module surface), showed **no
  change (68% → 68%)**: it has no ambiguous calls resolvable via params/fields. So the Swift path
  is added and fixture-tested but unexercised by real code here — the real validation is Kotlin.
- 21 HMS cross-repo links / 3 externals unchanged (the new edges are intra-repo); tests 60/60;
  new native-mini cases for field-typed and param-typed receivers plus a removed-wrong-edge
  (external receiver) assertion, for both Swift and Kotlin.

## [Unreleased] — Deeper Go receiver typing + external classification (ADR 0015)

- No schema change; core untouched (ADR 0005). Go extractor only.
- Extends the per-function type environment (ADR 0012) with package-level `var` types,
  function/method **result-type** inference (`x := f()` / `x := r.m()`), and two-variable
  **`range` element** types — so more receivers resolve to a precise `Type.method`.
- **External-receiver classification**: a call whose receiver resolves to a type *not* declared
  in the repo (`sql.DB`, `gin.Context`, …) is now counted `external` instead of
  `internalUnresolved`, and is not run through the global short-name fallback — which also
  removes *wrong* edges that fallback could emit (a call on `*sql.DB` linking to a coincidentally
  unique repo method). Refines ADR 0013's internal-vs-external split toward its stated meaning.
- **Honest measured result (modest):** HMS Go coverage hms-backend 51%→**53%**, hms-telephony
  85%→**86%**; hms-telephony call edges 394→389 (all dropped ones were false). The bigger lift
  first hypothesised did not materialise — the dominant unresolved receivers are closure params,
  repo-*interface* dispatch, and type-switch bindings, which are genuinely unresolvable
  syntactically (interface dispatch must not be guessed). So 53% is near the honest ceiling here.
- Folding closure parameters into the env was tried and **reverted** (made it worse: 53%→52%,
  −15 edges, since closure params are usually external types). Recorded in ADR 0015.
- Native (Kotlin/Swift) deliberately unchanged — categorise its unresolved calls first (earn-it).
- 21 HMS cross-repo links / 3 externals unchanged; tests 58/58; new go-mini fixtures for
  return-type, range-element, and external-pkg-var cases.

## [Unreleased] — Express mount-prefix + NestJS exposes (ADR 0014)

- No schema change: additive `exposes` only; the linker and core are untouched (ADR 0005).
- The TS extractor already emitted basic Express `exposes` (`app.get("/path", handler)`); a probe
  found two real gaps, now closed:
  - **Express mounted-router prefixes**: route registrations are collected keyed by their
    router's resolved declaration, and `parent.use("/prefix", router)` mounts are joined onto
    them — even across files (a `Router()` defined in one file and mounted in another), walked
    transitively through nested mounts. Unmounted routers keep their bare path (no regression).
  - **NestJS decorators**: a `@Controller(base)` class + method `@Get/@Post/...(sub)` decorators
    expose `VERB /base/sub`, handler = the method's `Class.method` node. Previously a Nest
    backend produced zero exposes (decorators aren't call expressions).
- Best-effort/syntactic where the value isn't static: dynamic prefixes, `RouterModule.forRoutes`
  config routing, and non-literal paths are skipped, not guessed (philosophy #5).
- Validated on probe fixtures (`fixtures/node-svc` + `fixtures/node-web`) — there is no real
  Node/Express/Nest backend in the dogfood workspaces (HMS is Go, ghost is RN), so this has
  weaker real-repo evidence than the Go/Kotlin work; the fixtures encode the common patterns and
  a cross-repo link test (FE `axios` calls ↔ Express mounted-router + Nest routes).
- HMS unchanged (no Node backend): 21 cross-repo links / 3 externals intact; tests 57/57.

## [Unreleased] — Call-resolution coverage signal (ADR 0013)

- No schema change: a new generated artifact `~/.atlas/<ws>/<repoId>.resolution.json` alongside
  `*.detection.json` (ADR 0003 generated data, not the schema-versioned topology); core untouched.
- Per repo (summed across its languages), Atlas now records a call-resolution summary —
  `resolved` / `internalUnresolved` (targets in-repo code but unpinned) / `external` (library/
  runtime) / `total` — and a headline **coverage = resolved / (resolved + internalUnresolved)**:
  of the calls that target in-repo code, the share that resolved into the graph. Library calls
  are excluded so a type-checked TS frontend and a syntactic Go backend are comparable.
  Descriptive, never a quality score (rejected.md): counts + one share + a plain meaning.
- The TS extractor gains the same counting (a call whose callee declares in-repo but wasn't
  mapped is `internalUnresolved`; node_modules/lib types are `external`). Go/native reuse the
  ADR 0012 buckets.
- Surfaced in `atlas status` (a per-repo line), `architecture.md` (a "Call-resolution coverage"
  section), and the `scan`/`refresh` console output; steering tells the agent to widen its own
  verification when a repo's coverage is low.
- Dogfooded on HMS: hms-admin 89%, hms-backend 51%, hms-mobile 59%, hms-landing 100%,
  hms-telephony 85%; 21 cross-repo links unchanged; tests green.

## [Unreleased] — Scope/receiver-aware call resolution (ADR 0012)

- No schema change: extractor output shape is unchanged; the core is untouched (ADR 0005).
- The Go and native (Swift/Kotlin) tree-sitter extractors no longer skip every call whose
  short name is non-unique in the repo. A shared, precision-ordered resolver
  (`extractors/shared/resolve.ts`) tries **receiver/type → same-scope → repo-global** and emits
  an edge only when a layer narrows to exactly one target — monotonic over the old global-unique
  policy (every prior edge preserved; only adds), so no wrong edges.
  - Go: a lightweight per-function type environment (receiver, params, `var`/`:=`) plus a
    repo-wide **struct-field** map resolves receiver chains like `s.deps.Auth.Register()`;
    bare `f()` resolves within the caller's package.
  - Native: bare/`this`/`self` calls resolve to the enclosing class's method (scope);
    `val/let x = Foo()` receivers resolve `x.m()` to `Foo.m` (receiver).
  - Supersedes the "ambiguous names are skipped" consequence of ADR 0008 / 0010 only.
- Per-repo resolution counters (total / resolved / via-layer / skipped-ambiguous / unresolved)
  are exposed out-of-band for measurement (and the upcoming coverage signal) — never persisted.
- Dogfooded on HMS (same source, before→after call edges): hms-backend 296→328, hms-telephony
  378→394, hms-mobile 1497→1601 (+152 total); TS repos unchanged; **21 cross-repo links and 3
  externals intact**; tests green; new fixtures/assertions for the receiver/scope/negative cases.

## [Unreleased] — Cross-platform (macOS / Linux / Windows)

- Confirmed/hardened cross-OS support: the git auto-refresh hook and the printed wiring lines
  now forward-slash absolute paths, so they're valid under Git Bash and copy-paste-correct on
  Windows (no-op on macOS/Linux). Core already used the `path` module + posix-normalized node ids.
- `docs/setup.md` rewritten with per-OS prerequisites (macOS Xcode CLT, Linux build-essential,
  Windows VS Build Tools + Python + Git Bash) and platform notes.

## [Unreleased] — Interactive menu

- `atlas menu` (`cli/menu.ts`): a numbered, interactive menu over the common actions; prompts
  for inputs (workspace pickers) and delegates to the existing run* functions. Bare `atlas` in
  a terminal opens it; non-interactive `atlas` still prints help. Pure UX, no new analysis.

## [Unreleased] — Status dashboard + reference docs

- `atlas status [<workspace>]` is now a dashboard (`cli/status.ts`): version/schema/store,
  every workspace with its repos, per-repo counts + language breakdown + freshness, cross-repo
  link / external totals, and whether agent docs are generated. (Replaces the old static stub;
  it now routes to the compiled command.)
- Heavy documentation of the durable surface (philosophy #9): `docs/cli.md` (full command
  reference, flags, exit codes, flows) and `docs/how-it-works.md` (end-to-end pipeline). Linked
  from README and AGENTS. No schema change.

## [Unreleased] — Conventions / golden-files surface

Adapted from codebase-context (the one genuinely new idea across the tool-comparison
exercises): help the agent write code that *fits*, not just code that compiles.

- `core/conventions.ts` (pure, deterministic — no LLM/scoring/trends): detects architectural
  layers from paths (`services/`, `handlers/`, `hooks/`, …), the dominant file-naming pattern
  per layer (`*_handler.go`, `use-*.ts`, `*Repository.kt`), and an **exemplar file** to copy
  (chosen by in-degree — the most-used file in that layer).
- Surfaced as a "Conventions" section in `architecture.md`, with a steering pointer to consult
  it before writing new files. No schema change.
- Dogfooded on HMS: correctly surfaced Go `*_handler.go`/`*_usecase.go`, React `use-*.ts`,
  Kotlin `*Repository.kt` with exemplars per layer.

## [Unreleased] — Agent-efficiency Tier 2 (neighborhood, landmines, search-nudge)

- **`atlas_neighborhood`** MCP tool (+ `queryNeighborhood`): the depth/size-bounded local call
  subgraph around a symbol in one call (`core/neighborhood.ts`) — fewer round-trips than
  separate context/impact/path queries.
- **Landmines** section in `architecture.md`: a bounded scan for `TODO/FIXME/HACK/XXX/BUG/
  WHY/NOTE` comments across the workspace (`cli/landmines.ts`), so the agent sees known caveats
  before editing nearby code. No schema change.
- **`atlas hook search-nudge`**: merges a Claude Code PreToolUse hook into
  `<repo>/.claude/settings.json` that reminds the agent to query Atlas before raw Grep/Glob
  (safe JSON merge, idempotent, `--remove` to undo). Best-effort.
- Deferred (intentionally): incremental/cached scanning — a large invalidation surface for a
  ~1.5s gain; full re-scan stays the safe default (rejected.md: stale-but-trusted is worse).

## [Unreleased] — Agent-efficiency Tier 1 (path, budgets, orientation)

Ports the deterministic, on-thesis agent-query refinements from graphify (no embeddings/
multimodal/clustering) to cut token cost and reduce mistakes.

- **`atlas path <A> <B>`** (+ MCP `atlas_path`): shortest connection between two symbols/files
  across the whole workspace, spanning call edges and cross-repo `http` contracts
  (`core/path.ts`, `cli/query.ts#workspaceGraph`). Answers "how does A reach B" in one query.
- **Bounded results**: `atlas impact` gains `--depth` (cap caller-walk depth) and `--limit`
  (cap returned callers, with "+N more"); MCP results cap lists at 50 with a `truncated` count.
  `transitiveCallers` takes `maxDepth`.
- **Orientation digest** in `architecture.md`: deterministic top hubs (most-called functions)
  + scoped "suggested questions" so an agent orients in one read (`core/orientation.ts`).
- Schema: `http` added to the `EdgeKind` union for the unified graph (clarification — extractor
  output never emits it; no version bump, persisted shapes unchanged).

## [Unreleased] — Mermaid diagram, language registry, git hook

- No schema change.
- `core/mermaid.ts`: pure `systemDiagram(map)` renders the cross-repo contract wiring as a
  Mermaid flowchart (subgraph per repo, solid edges = resolved contracts, dashed = external).
  `atlas agent`/`refresh` embed it in `architecture.md`. (Idea adapted from graphify; kept to
  the structured map — no LLM/embeddings/clustering, per ADR 0001/0002.)
- `extractors/native`: refactored into a config-driven **language registry** (`LANGUAGES`).
  Adding a tree-sitter language is one entry; `scan`/`refresh` auto-pick it up via
  `nativeLanguages()`. Swift/Kotlin behavior unchanged. See `extractors/README.md`.
- New `atlas hook install|uninstall [<repo>] -w <ws> [--event]`: installs a background git
  hook that runs `atlas refresh` after commits — deterministic regeneration on a trigger
  (philosophy #5), idempotent and non-clobbering, writes only under `.git/hooks` (ADR 0003).

## [Unreleased] — Go chi exposes precision fix

- Go extractor: a chi route now requires a `/`-prefixed literal path AND a handler argument,
  rejecting verb-method look-alikes like `url.Values.Get("kind")` / `header.Get("X-…")`.
  (HMS: hms-backend 39→32, hms-telephony 16→9 exposes; cross-repo links unchanged.)

## [Unreleased] — Kotlin Retrofit consumes (ADR 0011)

- No schema change.
- Kotlin extractor now emits `consumes` from Retrofit annotations (`@GET/@POST/...`),
  resolving route constants and `${X.Y}` string-template references via a repo-wide const map
  (e.g. `AuthRoutes.REGISTER → /api/v1/auth/register`).
- Linker: `normalizePath` now strips a non-root trailing slash, so a chi `"/"` leaf and a
  client call to the same path link (e.g. `/sync/blobs/{}/` ↔ `/sync/blobs/{}`).
- Dogfooded: the HMS workspace now spans 3 repos / 3 languages — `hms-admin` (TS) and
  `hms-mobile` (Kotlin/Retrofit) both link to `hms-backend` (Go/chi): 21 cross-repo contracts,
  3 honest externals (env-var base URLs).

## [Unreleased] — Go extractor + chi routes (ADR 0010)

- No schema change.
- `extractors/go` (tree-sitter-go, pinned `0.23.1` for ABI compatibility with the 0.21 core):
  `function`/method nodes (`Recv.method`), name-resolved `call` edges, and `exposes` for chi
  routes — resolving nested `r.Route(...)` prefixes and constant base paths
  (`BasePath = prefix + Version`). Handlers resolve precisely via `Type.method`.
- Detection now treats Go as extractable and infers `be` + framework from `go.mod` routers
  (chi/gin/echo/fiber/mux). `cli/extract.ts` runs the Go extractor when `.go` is present.
- Dogfooded on the HMS system: `hms-admin` (Next.js/TS) ↔ `hms-backend` (Go/chi) linked
  **7 cross-repo contracts** (e.g. `GET /api/v1/admin/clinics → AdminHandler.ListClinics`),
  3 honest externals (env-var base URLs); `atlas impact` on a Go handler lists the FE consumer.

## [Unreleased] — Automatic stack detection (ADR 0009)

- No schema change: detection drives the existing manifest `role`/`type` fields and the
  generated agent docs; detected frameworks live in generated data, not the manifest contract.
- `cli/detect.ts`: infers languages, frameworks (curated dep/config map), role, and workspace
  type from `package.json`, config, build files, and file extensions. Pure `inferStack` +
  `detectStack` (I/O). Local and deterministic (ADR 0006).
- `scan` auto-fills `--role`/`--type` from detection (still overridable) and writes a per-repo
  `*.detection.json` to the store; `refresh` re-detects.
- Agent artifacts (`atlas.steering.md`, `architecture.md`) now include the detected stack, so
  the agent learns the frameworks without being told.
- New `atlas detect <repo>` command prints what would be inferred.
- Boundary (ADR 0002 / rejected.md): detection selects extractors + context, never "workflows".

## [Unreleased] — Phase 4 (Swift + Kotlin extractors)

- No schema change: native output uses the existing v0 node/edge shapes.
- ADR 0008: Swift & Kotlin extractors via tree-sitter (one generic extractor, both grammars).
- `extractors/native`: emits `module` + `function` nodes and name-resolved `call` edges for
  `.swift` and `.kt`; qualifies methods as `Class.method`; resolves calls by unique short
  name within the repo (ambiguous → skipped); parses large files via a sized tree-sitter
  buffer and skips any unparseable file (graceful degradation).
- `cli/extract.ts`: per-repo orchestration — runs TS + auto-detected Swift/Kotlin and merges
  into one topology. `scan` and `refresh` both use it, so native code appears in `context`/
  `impact` and via the MCP server with no core changes (ADR 0005).
- `.npmrc` pins `legacy-peer-deps=true` (the grammar packages' tree-sitter peer ranges differ
  but are ABI-compatible — ADR 0008).
- Dogfooded on ghost_daddy: 721 functions (TS 344, Swift 181, Kotlin 196); native call graphs
  resolve across files (e.g. `NativeScreenView.initializeComponents` → its helpers).

## [Unreleased] — Phase 3 (expose the map to agents)

- No schema change.
- `mcp/server.ts`: MCP server (stdio, read-only over the data store, no network) exposing
  `atlas_context`, `atlas_callers`, `atlas_impact`, `atlas_endpoints`. New `atlas mcp` command.
- `cli/query.ts`: shared query layer (store + pure core) used by the MCP server.
- `atlas agent` command generates, into the data store, `architecture.md` (greppable summary)
  and `atlas.steering.md` (always-on agent context), and prints wiring for Claude Code /
  Cursor / Kiro. Generated artifacts stay in ~/.atlas (ADR 0003); only a one-line import
  goes into a target repo's CLAUDE.md, added by the user.
- Done-criterion demonstrated: an MCP client listed the tools and answered cross-repo
  questions (endpoints, impact) by calling the server.
- `atlas refresh` command: re-scans every repo in a workspace manifest, re-links, and
  regenerates the agent files in one step (a missing repo path is skipped, not an error).
  Keeps the map cheap to regenerate (philosophy #5); no background/auto-maintenance
  (that remains rejected — stale-but-trusted is worse than no map).

## [Unreleased] — Phase 2 (slice 2b: exposes + impact)

- No schema version bump: implements the already-documented v0 `exposes` shape (§2).
- Extractor emits `exposes` (Express-style `app/router.<verb>("/path", handler)`); the
  handler resolves to the named in-repo function node, else the registering scope.
- `core/impact.ts`: `transitiveCallers` (cycle-safe reverse reachability over call edges).
- New `atlas impact <symbol|file>` command: intra-repo transitive callers + cross-repo
  downstream consumers (via the merged map).
- Cross fixture (`fixtures/cross/{web,svc}`) verifies consume↔expose resolution end-to-end.
- Done-criterion demonstrated: a missing repo shows as `external`; adding it resolves the
  edge automatically; `atlas impact` lists downstream consumers across repos.

## [Unreleased] — Phase 2 (slice 2a: multi-repo scope + consumes + external nodes)

- No schema version bump: implements the already-documented v0 contracts —
  manifest (§1), `consumes` endpoints (§2), and the merged map (§3).
- Schema **clarification** (shape unchanged): `consumes.path` may be a real route or a
  *symbolic* expression; matchability is derived by the core, not stored.
- Data store moves to a per-workspace layout: `~/.atlas/<workspace>/{manifest,<repo>.topology,map}.json`.
- `atlas scan` now takes `--workspace`/`--role`/`--type`, upserts the repo into the
  workspace manifest, and re-links the workspace into `map.json` after extracting.
- Extractor emits `consumes` (HTTP client calls; symbolic paths kept verbatim, bare-identifier
  paths dropped). `exposes` still pending (slice 2b).
- `core/link.ts`: cross-repo linker matches `consumes`↔`exposes` by HTTP contract
  (method + param-normalized path) and emits `external` nodes for unmatched consumes.
- New `atlas endpoints` command lists cross-repo links and external (unmatched) endpoints.

## [Unreleased] — Phase 1

- Schema **clarification** (no version bump; shape unchanged, `schemaVersion` stays 0):
  documented that `module` nodes use the id `<repoId>:<relativeFile>` (no `#symbol`)
  and that `import` edges connect module nodes file → file. Existing v0 consumers
  parse this unchanged.
- TypeScript toolchain: `tsc` build (`npm run build`) + `node:test`/`tsx` tests (`npm test`).
- `extractors/typescript` (ts-morph): emits `function` nodes, per-file `module` nodes,
  `import` edges (module → module), and `call` edges (fn → fn) resolved to in-repo nodes.
- `core`: pure intra-repo `Graph` (callers/callees, symbol/file lookup) and context-pack builder.
- CLI: `atlas scan <repo>` writes topology to `~/.atlas`; `atlas context <symbol|file>`
  prints a target + its callers and callees (`--json`, `--repo` supported).

## [0.0.0] — Phase 0
- Documented, scaffolded, agent-ready foundation.
- Docs: vision, philosophy, phases, schema (v0), ADRs 0001–0007, rejected-ideas, AGENTS.md.
- Repo skeleton: core/, extractors/typescript/, cli/, mcp/, fixtures/, bin/.
- Runnable CLI stub (`atlas --help`, `atlas status`).
- Data schema version: 0.
