# core/

Language-agnostic engine. **Consumes only the normalized JSON from `docs/schema.md` —
never reads source code** (see ADR 0005).

Lives here (built in Phase 1+):
- graph builder (nodes + edges → queryable intra-repo graph)
- cross-repo linker (resolve `consumes` ↔ `exposes`, emit `external` nodes) — Phase 2
- impact analysis (forward/reverse reachability over the graph) — Phase 2
- context-pack generator (a symbol + its callers + callees)

This is the most stable, most-tested part of the codebase. Keep it pure where possible.
