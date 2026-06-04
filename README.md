# atlas

A personal, local-first tool that gives AI coding agents the one thing they can't
cheaply discover on their own: **a map of the whole system across repositories.**

> Status: **Phase 1** — single-repo core: scan a TypeScript repo and read a focused
> context pack (a symbol + its callers + callees). See [`docs/phases.md`](docs/phases.md)
> for what's built and what's next.

---

## The one-paragraph idea

Modern coding agents (Claude Code, Kiro, Antigravity) are very good at *searching
within a repo* on demand — grep, glob, read. They are bad at *seeing the shape of a
whole system* spread across many repositories. This tool does **not** try to out-search
the agent. It builds the structural map the agent can't: who calls whom, which frontend
endpoints map to which backend services, and what breaks if you change a given thing.
The agent brings the search; this tool brings the map.

## Three things that define it

1. **The agent does discovery; the tool provides the map.** No embeddings, no vector DB,
   no semantic index. See [ADR 0001](docs/adr/0001-agentic-search-over-embeddings.md).
2. **It scales from 1 repo to N.** One freelance frontend repo, or two frontends plus
   20+ backend microservices — same tool, different manifest. See [ADR 0004](docs/adr/0004-manifest-driven-scope.md).
3. **Everything is local.** Nothing leaves the machine; there is no index to leak.
   See [ADR 0006](docs/adr/0006-local-only-no-network.md).

## Quickstart (Phase 1)

```bash
npm install && npm run build

node bin/atlas.js scan /path/to/a/ts-repo        # → ~/.atlas/<repo>.topology.json
node bin/atlas.js context createOrder            # a symbol + its callers + callees
node bin/atlas.js context src/orders/api.ts      # or a file → its functions
node bin/atlas.js context createOrder --json     # machine-readable pack
```

`scan` reads the repo (never modifies it) and writes topology only to `~/.atlas`
(override with `ATLAS_HOME`). `npm test` runs the core + extractor tests.

## Read the docs in this order

1. [`docs/vision.md`](docs/vision.md) — what this is for and where it's going (the plan).
2. [`docs/philosophy.md`](docs/philosophy.md) — the principles that decide every trade-off.
3. [`docs/phases.md`](docs/phases.md) — the roadmap, phase by phase.
4. [`docs/schema.md`](docs/schema.md) — the keystone data contract (treat as a public API).
5. [`docs/adr/`](docs/adr/) — why each major decision was made.
6. [`docs/rejected.md`](docs/rejected.md) — what was deliberately *not* built, and why.

## Continuing development with an agent

If you (or an AI agent) are picking this up to build the next phase, **start with
[`AGENTS.md`](AGENTS.md).** It is the onboarding contract.
