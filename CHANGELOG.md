# Changelog

Schema changes must be recorded here (see docs/schema.md).

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
