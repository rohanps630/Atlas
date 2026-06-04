# 0005 - Thin extractors, fat language-agnostic core

Status: Accepted

## Context
The company system is polyglot (TypeScript frontends; backends likely a mix of Node, Go,
Python, Java). A single parser can't cover that, and per-language logic leaking into the core
would make every new language a core rewrite.

## Decision
- **Extractors** are per-language and do the minimum: read source, emit the normalized JSON
  in `schema.md`. They may use ecosystem tools (TypeScript Compiler API, `go list`, Python
  `ast`). They are allowed dependencies; they are expected to churn.
- **Core** (graph, cross-repo linker, impact, context packs) consumes only the normalized
  JSON and never sees source. It is language-agnostic and the most stable, most-tested part.

## Consequences
- Adding a language = adding one extractor; the core is untouched.
- The normalized schema (ADR-adjacent: schema.md) is the load-bearing contract — guard it.
- Test the core hard; don't over-test extractors early (they churn).
- Build the TypeScript extractor first: it covers both frontends and any Node backends.
