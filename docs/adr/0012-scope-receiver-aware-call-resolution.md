# 0012 - Scope- and receiver-aware call resolution in the tree-sitter extractors

Status: Accepted

## Context
The tree-sitter extractors (Go — ADR 0010; Swift/Kotlin — ADR 0008) resolve a `call`
edge only when the callee's **short name is unique across the whole repo**, and skip the
call otherwise. Both extractors implement the identical policy:

- Go: `extractors/go/index.ts` — `byShortName.get(callee)`; emit only if `length === 1`.
- Swift/Kotlin: `extractors/native/index.ts` — same, `length !== 1 → continue`.

This was an accepted consequence of ADRs 0008 and 0010 ("calls are resolved by name within
the repo, so overloads/shadowing can mis-link" / "ambiguous names are skipped"). The cost is
**undercounting**: any call to a name that appears more than once in the repo is dropped
entirely — even when the surrounding scope or receiver type makes the target unambiguous.
Because `impact` and `path` walk the call graph, they under-report blast radius on exactly the
languages where short-name collisions are common: a Go repo with many `Service.Get`/`save`
methods, a large Kotlin app (hms-mobile: 1643 nodes / 1497 resolved calls today, with an
unknown number skipped). The whole value of Atlas is an *exact* map (philosophy #2); a known,
measurable undercount is worth closing if it can be done **without introducing wrong edges**.

The constraint that makes this safe: we resolve **more** calls only when context narrows the
candidates to exactly one. When it does not, we behave exactly as before (skip). No edge is
ever emitted by guessing among equally-plausible candidates.

## Decision
Replace the single global-unique check in both tree-sitter extractors with a **layered
resolver** that tries candidate sets in descending order of precision and emits an edge only
when a layer yields **exactly one** candidate; otherwise it falls through, and if no layer
disambiguates, the call is skipped (today's behavior). The layers:

1. **Receiver/type-aware** (most precise):
   - **Go** — for `recv.Method(...)`, infer `recv`'s static type from a lightweight,
     per-function environment built syntactically (no type checker): the method receiver
     (`func (s *Service)`), local `var x T` / `x := T{}` / `&T{}` composite literals, and
     struct-field types. Resolve to `T.Method` via the existing `Type.method` index
     (`byFullName`). Bare `f(...)` calls are package-local functions — resolved in layer 2.
   - **Swift/Kotlin** — for `x.method()` where `x` is bound by `val/let x = Foo(...)`,
     resolve to `Foo.method`; for a bare `method()` / `this.method()` inside class `C`,
     prefer `C.method`.
2. **Same-scope unique** — if the short name is ambiguous repo-wide but **unique within the
   caller's own scope**, resolve to that one. Scope = the Go *package* (the file's directory,
   per Go's language rule that unqualified calls are same-package) for Go, and the enclosing
   *class* then *file* for Swift/Kotlin.
3. **Global unique** — exactly one match repo-wide → resolve. (Unchanged from today.)

The shared index/singleton-pick logic lives in a small new `extractors/shared/` module used by
both extractors. This stays entirely **extractor-side**: the normalized JSON shape (schema §2)
is unchanged, so the **core is untouched** (ADR 0005) and there is **no schema change**.

This ADR **supersedes the "ambiguous names are skipped" consequence** of ADR 0008 and ADR 0010
only; everything else in those ADRs (tree-sitter choice, chi/Retrofit endpoint extraction,
syntactic best-effort posture) stands.

## Consequences
- **More correct edges, no wrong edges.** `impact`/`path` under-report less on Go/Kotlin/Swift.
  Edges are added only for calls a precision layer narrows to a single target; genuinely
  ambiguous calls are still skipped, preserving the no-false-edge property.
- **Still syntactic and best-effort** (philosophy #5). The Go "type environment" is a
  lightweight syntactic inference, not a type checker: it resolves the common local-variable /
  receiver / field cases and gives up (falls through to scope/global, or skips) on anything it
  can't see — interface values, returns of other calls, embedded promotion, cross-package
  types. The map remains a hint to verify, never authority.
- **Measurable.** The extractors gain per-repo resolution counters (total call sites / resolved
  / skipped-ambiguous / unresolved). These produce the before/after evidence for this change
  and are the raw signal for the separate coverage/confidence work — kept descriptive, never a
  quality score (rejected.md).
- **Guardrails.** The change must keep `npm test` green (with new fixtures/assertions for the
  receiver and same-scope cases, plus a negative test that an unresolvable ambiguous call emits
  no edge), keep `typecheck` clean, and not regress the hms workspace's 21 cross-repo links.
- **Shared extractor code.** A small `extractors/shared/` helper introduces coupling between
  the Go and native extractors, accepted to prevent the two copies of the resolution policy
  from drifting. It is still extractor-side and language-agnostic about *node shape* only.
