# 0009 - Automatic stack detection drives scan config

Status: Accepted

## Context
Atlas already auto-selects language extractors by file presence, but the repo's **role**
(`fe`/`be`/…) and **workspace type** still had to be passed by hand, and nothing read the
signals a developer uses to recognize a stack: dependency manifests (`package.json`),
config (`app.config.ts`, `next.config.*`, `tsconfig`), build files (`Podfile`,
`build.gradle`), and project structure. Manual flags cut against philosophy #7 ("same tool,
different manifest") — the manifest should be cheap to generate, not hand-curated.

The request also reached toward "select appropriate workflows." That is out of bounds:
ADR 0002 fixes Atlas's product as *the structured map*, and philosophy #1 leaves the
workflow to the agent. So detection configures **what Atlas extracts and what context it
hands the agent** — not how anyone works.

## Decision
Add a deterministic, local (ADR 0006) stack detector that reads dependency manifests, config,
build files, and file-extension presence, and infers: **languages**, **frameworks** (curated
dep/config signal map — Expo, React Native, Next.js, React, Express, NestJS, …), a suggested
**role**, and **workspace type** (monorepo signals → `company`).

- `atlas scan` runs detection and **auto-fills `--role`/`--type`** when not given (still
  overridable). It writes a per-repo `*.detection.json` into the data store (generated data,
  ADR 0003 — *not* part of the schema-versioned manifest).
- The agent artifacts (`atlas.steering.md`, `architecture.md`) include the detected stack, so
  a coding agent gets "Expo RN app, native modules, axios API layer" without being told.
- **No schema change:** detection drives the existing manifest `role`/`type` fields and the
  generated docs; detected frameworks live in generated data, not the manifest contract.

## Consequences
- `scan` needs no manual flags in the common case; detection is a *hint* (philosophy #5) and
  always overridable — never an error if it guesses wrong.
- Detection knowledge (the dep→framework map) is curated and will drift; it lives outside the
  core (which stays language-agnostic and only consumes normalized JSON, ADR 0005).
- Detecting a language Atlas can't yet extract is reported as "present (no extractor yet)",
  not silently claimed — honest about coverage.
- Scope guard: detection selects extractors + context only. It does not pick or run workflows
  (ADR 0002, rejected.md).
