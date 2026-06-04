# Kickoff prompt

Paste the prompt below as your **first message** to an AI agent (Claude Code, Kiro, or
similar) with this repo's folder open. It makes the agent read the foundation docs, prove
it understood them, and propose a plan **before** writing code. Reuse it every time you
pick the project back up.

When the agent asks which repo to dogfood against, give it a TypeScript repo you know well
so you can sanity-check the graph it produces.

---

```
You're joining an existing project called `atlas` to continue its development.
Do NOT write any code yet — onboard first.

1. Read these files, in this order, and treat them as authoritative:
   - AGENTS.md            (your onboarding contract — read this first)
   - README.md
   - docs/vision.md
   - docs/philosophy.md
   - docs/phases.md
   - docs/schema.md
   - every file in docs/adr/
   - docs/rejected.md

2. Then, before touching any code, reply with:
   a. A 5–8 line summary, in your own words, of what atlas is and the one
      core decision that shapes it (so I know you actually read it).
   b. The current phase and the exact deliverables for the NEXT phase,
      taken from docs/phases.md.
   c. A concrete implementation plan for that phase: which files you'll
      create or change, in what order, and how you'll satisfy that phase's
      stated "done criteria."
   d. Any decisions you need from me before starting (e.g., which real repo
      to dogfood against).

Rules you must follow at all times (from AGENTS.md):
   - Stay strictly within the current phase. Do not pull work from later
     phases or from docs/rejected.md.
   - Never re-add a rejected idea (embeddings, health scoring, audits, etc.)
     without first writing a superseding ADR in docs/adr/.
   - Treat docs/schema.md as a versioned public contract. To change it, bump
     schemaVersion, update the doc, and add a CHANGELOG.md entry.
   - Keep the extractor/core boundary (ADR 0005) and make no network calls
     in the analysis pipeline (ADR 0006).
   - Never modify the repos being analyzed; generated data goes only to the
     data store (~/.atlas), never into this repo.
   - Keep every change small and runnable. Dogfood over completeness.

Wait for my go-ahead on your plan before you implement anything.
```
