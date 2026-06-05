# Changelog

Schema changes must be recorded here (see docs/schema.md).

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
