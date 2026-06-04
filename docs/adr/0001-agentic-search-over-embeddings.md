# 0001 - Agentic search replaces embeddings

Status: Accepted

## Context
The original plan included a semantic layer: embed code chunks into a local vector DB and
retrieve by similarity. But the agents this tool serves (Claude Code, Kiro, Antigravity) do
discovery themselves with grep/glob/read. Claude Code's team built RAG with a local vector
DB into early versions, tested it against agentic search, and found agentic search clearly
better — so they dropped indexing entirely. The reported reasons: precision (grep finds exact
matches; embeddings introduce fuzzy positives), freshness (no index to go stale), zero setup,
and no stored index to leak. Embeddings also never solved this tool's real problem, which is
cross-repo structure, not in-repo similarity.

## Decision
No embeddings, no vector DB, no semantic index. Let the agent's own search do in-repo
discovery. This tool provides only the structured cross-repo map.

## Consequences
- Removes the heaviest, most fragile component (model download, vector store, re-embedding).
- Removes the IP/NDA exposure of embedding client code (there is no stored copy of code).
- Removes a whole class of staleness bugs.
- Cost: agents spend tokens/latency searching — but that is the agent's cost, not ours, and
  it is the accepted industry trade-off.
- The "find by concept when I don't know the name" use case is handed to the agent, which is
  good enough; if it ever proves insufficient, revisit with an ADR (do not silently re-add a
  vector DB).
