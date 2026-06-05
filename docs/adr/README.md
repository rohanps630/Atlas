# Architecture Decision Records

Short notes capturing **why**, not what. When you revisit this project after months, these
are the most valuable docs in the repo. When a future decision overturns one of these, do
not silently change course — write a new ADR that **supersedes** the old one and link them.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-agentic-search-over-embeddings.md) | Agentic search replaces embeddings | Accepted |
| [0002](0002-structured-map-is-the-product.md) | The structured map is the product | Accepted |
| [0003](0003-three-location-architecture.md) | Tool repo / data store / target repos are separate | Accepted |
| [0004](0004-manifest-driven-scope.md) | The manifest defines scope | Accepted |
| [0005](0005-extractor-core-boundary.md) | Thin extractors, fat language-agnostic core | Accepted |
| [0006](0006-local-only-no-network.md) | Local-only, no network in the pipeline | Accepted |
| [0007](0007-language-typescript-node.md) | Build the tool in TypeScript/Node | Accepted |
| [0008](0008-native-extractors-tree-sitter.md) | Swift & Kotlin extractors via tree-sitter | Accepted |
| [0009](0009-automatic-stack-detection.md) | Automatic stack detection drives scan config | Accepted |
| [0010](0010-go-extractor-tree-sitter-chi.md) | Go extractor via tree-sitter, with chi routes | Accepted |
| [0011](0011-kotlin-retrofit-consumes.md) | Kotlin Retrofit consumes extraction | Accepted |
| [0012](0012-scope-receiver-aware-call-resolution.md) | Scope- & receiver-aware call resolution (tree-sitter) | Accepted |
| [0013](0013-call-resolution-coverage-signal.md) | Call-resolution coverage signal (descriptive, not a score) | Accepted |
| [0014](0014-express-nest-exposes.md) | Express mount-prefix + NestJS exposes extraction | Accepted |

## Format

```
# NNNN - Title
Status: Proposed | Accepted | Superseded by NNNN
## Context   (the forces at play)
## Decision  (what we chose)
## Consequences (what this gives us and costs us)
```
