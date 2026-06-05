# 0013 - Call-resolution coverage signal

Status: Accepted

## Context
`atlas impact`/`path` walk the call graph, but that graph is incomplete: the syntactic
extractors (Go/native) can't resolve every call, and even the type-aware TS extractor drops
calls into library code. Philosophy #5 says the map is a *hint to verify* — but today a user or
agent has no way to tell **how much** of a repo's call graph actually resolved, so they can't
calibrate how far to trust an `impact` result. After ADR 0012 the extractors compute exactly the
raw material to answer this (per-call resolution outcomes), but it's thrown away.

The hazard to avoid is explicit in `rejected.md`: **no health scores**. A "code quality: 7/10"
number is arbitrary and misleading. This signal must be **descriptive** (counts + a derived
share, with a plain-language meaning) — never a grade, threshold, or pass/fail.

A second hazard is a **misleading denominator**. Counting every call site as the denominator
would punish a library-heavy frontend: a React component that mostly calls `useState`,
`map`, `console.log` would show "low coverage" even though every *in-repo* call resolved
perfectly. The signal must separate "call we couldn't resolve but that targets in-repo code"
(a real gap that lowers trust) from "call into a library" (expected, not a gap).

## Decision
Compute, per repo (aggregated across its languages), a **call-resolution summary** — generated
data, not a schema contract — and surface it descriptively in `atlas status` and
`architecture.md`.

The summary has four counts over a repo's call sites:
- `resolved` — became a `call` edge to an in-repo node.
- `internalUnresolved` — the call names something that *could* be in-repo but we couldn't pin
  it (Go/native: short-name matched ≥2 repo symbols and no scope/receiver layer disambiguated —
  ADR 0012's `skippedAmbiguous`; TS: the callee's symbol declares inside the repo but we didn't
  map it to a node).
- `external` — the call targets no in-repo candidate (library/stdlib/runtime). Expected.
- `total` — all call sites considered.

The headline is **coverage = resolved / (resolved + internalUnresolved)** — "of the calls that
target in-repo code, the share we resolved into the graph." It deliberately **excludes
`external`** so a library-heavy repo isn't penalised, making the number comparable across a
type-checked TS frontend and a syntactic Go backend. It is reported as a percentage **with the
raw counts beside it** and a one-line meaning ("impact/path on this repo see N% of its in-repo
calls; treat the rest as possible blind spots"). No thresholds, no colour-grading, no aggregate
"workspace score".

Persistence mirrors detection (ADR 0009): `cli/extract.ts` aggregates a `CallResolution` per
repo and `scan`/`refresh` write `~/.atlas/<ws>/<repoId>.resolution.json` (generated data,
ADR 0003 — **not** the schema-versioned topology). The extractor JSON the core consumes is
unchanged, so the **core and schema are untouched** (ADR 0005). The Go/native extractors already
produce the buckets (ADR 0012, out-of-band stats); the TS extractor gains the same lightweight
counting via the symbol it already resolves.

## Consequences
- A user/agent can calibrate trust in `impact`: a repo at 100% coverage means the call graph is
  (syntactically) complete; a lower number names how much may be missing — directly serving
  philosophy #5 without pretending the map is authority.
- Honest by construction: external/library calls don't drag the number down, and TS (type-
  resolved) and Go/native (syntactic) are reported on the same comparable basis.
- Descriptive, not a score (rejected.md): counts + one derived share + a plain meaning; no
  grade, threshold, or quality verdict. If it ever drifts toward a "health score" it should be
  removed.
- Additive generated data only: a new `*.resolution.json` artifact alongside `*.detection.json`;
  schema and core untouched; `status`/`architecture.md` gain a section.
- Best-effort, like the data it describes: `internalUnresolved` is itself a heuristic (a
  syntactic guess for Go/native, a symbol-origin check for TS), so the coverage number is itself
  a hint — stated as such, never as a precise audit.
