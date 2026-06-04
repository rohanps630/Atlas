# Rejected / deferred ideas

This file exists to stop scope creep — including from a future AI agent (or future me at 1am)
that "helpfully" re-adds these. **Do not build anything here without first writing an ADR that
names the real, recurring problem it solves and supersedes the relevant decision.**

| Idea | Why not (now) | Revisit if |
|------|---------------|------------|
| **Embeddings / vector DB** | Agents do in-repo search themselves; embeddings never solved the cross-repo problem; staleness + IP exposure. See ADR 0001. | "Find by concept" via the agent proves genuinely insufficient in practice. |
| **Health scoring (1–10)** | Thresholds are arbitrary (LOC, call counts); produces vanity metrics that look objective but aren't. | Never, unless tied to a concrete decision the score would drive. |
| **API drift report (as a feature)** | The *data* (consumes vs exposes) falls out of the map for free; a standalone report is premature. | A specific drift bug bites repeatedly and a report would have caught it. |
| **Env-var audit** | Solved adequately by existing linters/tooling; not "the map." | Cross-env env drift becomes a recurring, painful source of bugs. |
| **Dependency freshness reports** | Renovate/Dependabot already do this well. | Only if those tools can't be used in a given context. |
| **Auto-generated catalogs everywhere** | Maintenance burden; they go stale and then mislead. See philosophy #5. | A specific catalog is read often enough to justify keeping it fresh. |
| **15-command CLI** | Most commands are speculative. Start with `scan`, `context`, `impact`. | A command earns its place by being wanted repeatedly. |
| **Zero-dependency dogma** | Forces brittle hand-rolled parsers; worse than using the TS compiler / `go list` / `ast`. | Never — prefer *minimal* deps in extractors, light deps in core (ADR 0005). |
| **"AI maintains the topology forever"** | Stale data that's trusted is worse than no data. | Never — regeneration must be cheap and the map is always a hint (philosophy #5). |

The discipline this file encodes: **add features only when a real problem appears, not in
anticipation of one.**
