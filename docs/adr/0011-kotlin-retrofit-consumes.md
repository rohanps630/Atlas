# 0011 - Kotlin Retrofit consumes extraction

Status: Accepted

## Context
The HMS Android app (`hms-mobile`) is the Kotlin client of the Go backend. Its API calls are
Retrofit interface methods annotated with the verb and a **route constant**:
`@POST(AuthRoutes.REGISTER)` where `REGISTER = "${ApiVersion.V1}/auth/register"` and
`ApiVersion.V1 = "api/v1"`. The Kotlin extractor (ADR 0008) only emitted functions/calls, so
the mobile app appeared in the map but never linked to the backend it consumes.

## Decision
Extend the Kotlin path of the native extractor to emit `consumes` from Retrofit annotations:
- A `function_declaration` whose `modifiers` carry a `@GET/@POST/@PUT/@DELETE/@PATCH`
  annotation is a consumed endpoint; the method is the annotation name.
- The annotation argument is a route constant (or string literal). Paths are resolved through
  a repo-wide const map (`val NAME = "..."`) that substitutes `${X.Y}` template references
  recursively, so `AuthRoutes.REGISTER → "api/v1/auth/register"`. A leading `/` is ensured so
  it normalizes to a real route and links by HTTP contract.

This mirrors ADR 0010 (chi `exposes` for Go): framework-specific endpoint extraction layered
on the generic tree-sitter extractor, emitting the same normalized schema.

## Consequences
- The Kotlin mobile client links to the Go backend (auth + sync) — a third language in one
  cross-repo map, core untouched (ADR 0005).
- Const resolution is textual and best-effort; routes built at runtime or via unresolved
  constants are skipped (a hint, #5). Retrofit is the first Kotlin HTTP client supported;
  others (Ktor) would be added the same way, earn-it.
- Related normalization fix: trailing slashes are not significant for contract matching, so a
  chi `"/"` leaf (`/blobs/{uid}/`) and a client call (`/blobs/{uid}`) link.
