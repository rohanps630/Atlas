# Changelog

Schema changes must be recorded here (see docs/schema.md).

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
