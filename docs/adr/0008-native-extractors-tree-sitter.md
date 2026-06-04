# 0008 - Swift & Kotlin extractors via tree-sitter

Status: Accepted

## Context
Real React Native apps (e.g. the dogfood repo) ship custom native modules: Swift on iOS,
Kotlin on Android, living alongside the TypeScript that bridges to them. Phase 4 is exactly
"support the actual languages of my real services," and these now qualify. The TypeScript
extractor uses ts-morph; there is no equally convenient single tool for Swift and Kotlin:
- Swift's first-party tooling (SwiftSyntax / SourceKit) is macOS-bound and heavy.
- Kotlin's compiler PSI is a JVM dependency, heavy and awkward from Node.
Building two compiler-grade extractors with different toolchains is disproportionate for a
personal tool whose map is explicitly a *hint*, not authority (philosophy #5).

## Decision
Build per-language extractors in `extractors/swift/` and `extractors/kotlin/` using
**tree-sitter** (Node bindings) with the `tree-sitter-swift` and `tree-sitter-kotlin`
grammars. They emit the same normalized JSON as every other extractor (schema.md §2):
`function` nodes (and `module` nodes per file) and `call` edges resolved by name within the
repo. One parsing approach covers both languages with no Xcode/JVM toolchain.

Because a native module is part of one app, native output is **merged into the same repo's
topology** as the TypeScript output (one `ExtractorOutput` per repo, mixed-language nodes);
`atlas scan` auto-detects which languages are present (`.swift` / `.kt` outside build/Pods
dirs) and runs the matching extractors. The manifest `language` field stays the repo's
primary language; this needs no schema change.

## Consequences
- Adding a language stays additive (ADR 0005): the core — graph, linker, impact, MCP,
  refresh — is untouched; it still only consumes normalized JSON.
- Lower precision than a type-aware extractor: calls are resolved by name within the repo,
  so overloads/shadowing can mis-link. Acceptable — the map is a hint to verify (#5).
- Extractor dependencies are allowed (ADR 0005). tree-sitter grammars are native addons
  built via node-gyp; this assumes a C toolchain on the dev machine (present on macOS).
- HTTP `consumes`/`exposes` stay empty for native code (it doesn't speak HTTP here). The
  **JS ↔ native bridge** (which TS shim maps to which native module) is *not* modeled yet;
  if it proves valuable, add it as a follow-up (likely a new edge kind) under its own note.
- Scope guard: native extraction is functions + calls only, mirroring the Phase 1 TS scope.
  No speculative native features.
