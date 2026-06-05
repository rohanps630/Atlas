# 0015 - Deeper Go receiver typing + external-receiver coverage classification

Status: Accepted

## Context
ADR 0012 made Go call resolution scope/receiver-aware and ADR 0013 added a coverage signal
(`resolved / (resolved + internalUnresolved)`). On the HMS Go backend coverage read **51%**,
which invites the assumption that ~half the call graph is missing. Categorising the 249
ambiguous `x.Method()` calls that drive the number told a different story:

- **223** had a receiver identifier the type environment never captured (a package-level var, a
  `range` variable, or `:=` from a call) — so they fell through to the global short-name layer
  and, being ambiguous there, were counted `internalUnresolved`.
- **23** had a receiver we *could* type, but to an **external** type (`sql.DB`, `gin.Context`,
  …); the method is external, yet because its short name collides with a repo method it was
  still bucketed `internalUnresolved`.
- only **3** were genuinely resolvable internal edges we were missing; **0** were interface
  receivers (correctly never guessed) and **0** were embedded-method dispatch.

So the 51% is dominated by **external method calls mis-counted as internal-unresolved**, not by
missing internal edges. The honest fix is to *type more receivers* and, when a receiver's type
is provably **not** a repo type, classify the call as `external` (which ADR 0013 already defines
as "no in-repo candidate") instead of `internalUnresolved`. That makes coverage truthful — it
should measure how well we resolve calls into *repo* code, not penalise calls into libraries.

## Decision
Extend the **Go** extractor (ADR 0012 mechanism; core/schema untouched, ADR 0005):

1. **More type sources** in the per-function environment / receiver-expression typing:
   - **Package-level `var`** declarations (a repo-wide name→type fallback when an identifier
     isn't a local/param/receiver).
   - **Result-type inference** for `x := f()` and `x := r.m()` — from a repo-wide map of
     function and method result types (first result; best-effort).
   - **`range` element types** where the collection's element type is syntactically recoverable
     (`for _, x := range coll` with `coll` typed `[]T` / `map[K]T`).
2. **External-receiver classification.** Build the set of type names declared in the repo. When a
   call's receiver resolves to a type `T`:
   - `T.method` exists in the repo → resolve (receiver layer), as today;
   - else `T` is **not** a repo type → the call is **external**: count it as such and do **not**
     fall through to the global short-name layer (which would mis-bucket it as ambiguous);
   - else (`T` is a repo type but has no such method — e.g. embedded/promoted) → fall through to
     the global layer, as today.
   Receivers we still can't type, and interface-typed receivers, stay `internalUnresolved` /
   unresolved — we never guess among candidates.

This refines ADR 0013's `internalUnresolved`-vs-`external` split toward its stated definition; it
is a classification correctness fix, not a new metric. No new wrong edges: edges are still only
emitted on a single `Type.method` match.

## Consequences
- **Measured outcome (honest, smaller than first hypothesised).** On HMS the lift was modest:
  hms-backend 51% → **53%**, hms-telephony 85% → **86%**. The pre-implementation guess that
  "most of the 223+23 reclassify to external" was wrong — only ~29 did. The dominant unresolved
  receivers turned out to be hard cases the new sources don't reach (closure parameters,
  repo-*interface* dispatch, type-switch bindings), which are genuinely unresolvable without a
  real type checker (interface dispatch in particular *must not* be guessed). So 53% is close to
  the honest ceiling for a syntactic extractor here — a truthful signal, not a defect.
- **Correctness win regardless of the coverage delta**: external-receiver classification removes
  *wrong* edges the old global-short-name fallback could emit (a call on `*sql.DB` linking to a
  coincidentally-unique repo method) — e.g. hms-telephony call edges 394 → 389, all of the
  dropped ones false. `impact`/`path` get slightly fewer but more trustworthy edges.
- A tried-and-rejected extension: folding **closure parameters** into the env made things *worse*
  (hms-backend 53% → 52%, −15 edges) because closure params are usually external types
  (`*gin.Context`, `*sql.Tx`); it was reverted. Recorded here so it isn't re-attempted.
- Still syntactic and best-effort, deliberately not a type checker: multi-return assignments,
  generics, embedded-method promotion, cross-package var types, and interface dispatch remain
  partial or unresolved (a hint, #5). No guessing among same-named candidates.
- Scope guard: **Go only.** Native (Kotlin/Swift, hms-mobile 59%) is *not* changed here — its
  unresolved calls haven't been categorised yet; extend it once measured (earn-it, philosophy
  #10). Go-repo coverage shifts slightly on the next `refresh` (noted in the CHANGELOG).
