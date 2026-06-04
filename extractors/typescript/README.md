# extractors/typescript/

The first extractor. Reads a TypeScript/JavaScript repo and emits the normalized
extractor-output JSON defined in `docs/schema.md`.

- Use the TypeScript Compiler API (or ts-morph). Dependencies are allowed here (ADR 0005).
- Phase 1 scope (minimal): nodes for functions, edges for imports + calls.
- Phase 2 scope: endpoint extraction — `consumes` (HTTP client calls) and, for Node
  backends, `exposes` (route handlers).

Covers both the frontends and any Node backends — build it first.
