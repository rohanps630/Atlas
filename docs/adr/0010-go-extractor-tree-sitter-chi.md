# 0010 - Go extractor via tree-sitter, with chi route extraction

Status: Accepted

## Context
A real backend in the owner's system (`hms-backend`) is Go using the chi router. Phase 4
calls for a Go extractor, and suggested `go list`. But:
- `go list` / `go/packages` needs the Go toolchain present and gives package/type data, not
  HTTP routes — and routes are the cross-repo payoff (FE `consumes` ↔ BE `exposes`).
- We already use tree-sitter for Swift/Kotlin (ADR 0008); reusing it keeps one approach and
  no extra toolchain.

chi routes are non-trivial to recover syntactically: they nest via
`r.Route("/prefix", func(r chi.Router){ ... })`, the base prefix is a *constant*
(`r.Route(api.BasePath, …)` where `BasePath = prefix + Version`), and handlers are method
values (`deps.AuthHandler.Register`).

## Decision
Add `extractors/go` using `tree-sitter-go`, emitting the standard normalized JSON:
- `function` nodes for `function_declaration` and `method_declaration` (named `Recv.method`);
  `call` edges resolved by unique short name within the repo (same policy as ADR 0008).
- `exposes` for chi route registrations: walk each leaf `r.<verb>("/path", handler)` up its
  ancestors to collect enclosing `r.Route(prefix, …)` / `r.Mount(prefix, …)` prefixes and
  build the full path. Prefix args that are **string constants** are resolved via a repo-wide
  const map that evaluates simple string literals and `+` concatenations (so
  `BasePath = prefix + Version` → `/api/v1`). Param segments (`/{id}`) normalize like any
  other route at link time.

## Consequences
- A real polyglot map: the Go backend's endpoints link to the TypeScript frontend's calls by
  HTTP contract, with the core untouched (ADR 0005).
- Syntactic, not type-checked: name-based call resolution and best-effort const evaluation can
  miss dynamically-built routes or non-trivial const expressions. The map is a hint (#5);
  unresolved prefixes leave a route recorded with the literal prefixes we *could* resolve.
- chi is the first supported Go router; other routers (gin/echo/mux) would be added the same
  way if a real service needs them (earn-it). Generic `func`/`call` extraction is router-agnostic.
- Deviates from the roadmap's "go list" note; this ADR supersedes that suggestion for Go.
