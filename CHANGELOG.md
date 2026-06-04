# Changelog

Schema changes must be recorded here (see docs/schema.md).

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
