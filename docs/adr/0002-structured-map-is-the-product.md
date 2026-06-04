# 0002 - The structured map is the product

Status: Accepted

## Context
Agentic search is strong at "find the needle in a repo" and weak at "understand the shape of
a system across many repos." That weakness is exactly the company scenario (2 frontends + 20+
microservices). An agent grepping across 22 repos every session to reconstruct the call graph
is slow, expensive, and unreliable — and embeddings (see ADR 0001) never solved it either,
because semantic similarity is not a call edge.

## Decision
The tool's sole job is to produce and serve the **structured map** the agent cannot cheaply
derive: cross-repo topology, FE↔service contract links, and impact analysis. Everything else
is out of scope until proven necessary.

## Consequences
- Sharp, defensible scope: build the map, nothing else.
- The deliverable is precise and deterministic (graph queries), not probabilistic.
- In a single repo the cross-repo layer is inert — fine; the intra-repo graph still helps.
- Features that aren't "the map" (health scores, audits) are deferred by default (ADR 0004,
  rejected.md).
