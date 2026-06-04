# Vision — the plan and where this is going

This is a **personal tool**, owned and improved over years, used across both freelance
work and a company codebase. It is intentionally not a product for others. Every decision
optimizes for *one developer working effectively across wildly different project sizes*.

## Who it's for

Me. One developer who moves between very different contexts and wants a single, familiar
tool that adapts instead of needing reconfiguration each time.

## The scenarios it must handle

The tool must be useful and correct across this whole range without code changes — only
the manifest differs:

| Scenario | Repos available | What matters most |
|----------|-----------------|-------------------|
| **Freelance, single FE** | 1 frontend repo, no backend access | Fast orientation in an unfamiliar codebase; a map of which external backends the FE depends on |
| **Freelance, partial access** | 1 FE + some backend repos | Cross-repo links for the repos I *do* have; "unknown" placeholders for the ones I don't |
| **Company system** | 2 frontends + 20+ backend microservices, one system | Whole-system topology, contract links FE↔services, impact analysis across the mesh |

## The goal

One tool that is **versatile, adaptable, and correct regardless of repo count or project
structure.** It treats whatever repositories I currently have as a *partial view of a larger
system*, and makes "the part I can't see" a first-class concept rather than a failure.

## What success looks like

- Walking into a new freelance repo, I get a useful map on day one.
- On the company system, I can ask "what breaks if I change this endpoint?" and get an
  answer that spans the frontends and the relevant services.
- The tool never blocks or errors because a repo is missing — it degrades gracefully.
- Years from now it still works, because the durable contracts (schema, decisions) were
  documented heavily and the volatile parts were kept thin and replaceable.

## Long-term direction

- **Phase 1–2:** the structural core (graph, manifest, cross-repo contract linking,
  impact analysis) — the irreducible value.
- **Phase 3:** expose the map to agents via an MCP server so Claude Code / Kiro can query
  it on demand (`impact`, `callers`, `context`).
- **Phase 4:** add language extractors (Go, Python, Java) only as real services demand them.
- **Phase 5+:** audit/reporting features (drift, env, health) — only if a real problem
  appears. These are explicitly deferred; see [`rejected.md`](rejected.md).

The compounding bet: each phase makes the next change safer and each query faster. The
investment is in the *map* and the *documented reasoning*, not in chasing features.
