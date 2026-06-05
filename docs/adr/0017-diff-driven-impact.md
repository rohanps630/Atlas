# 0017 - Diff-driven impact (`atlas impact --diff`)

Status: Accepted

## Context
`atlas impact <symbol|file>` answers "if I change this, what breaks?" for one target. In PR/CI
review the question is usually about a **whole change**: "given this diff, what's the blast
radius?" The predecessor system had a `pr-impact` script for exactly this. The impact engine
(`core/impact.ts` transitive callers + the cross-repo consumer lookup) already exists — this is a
thin front-end, not new analysis.

## Decision
Add a `--diff` mode to `atlas impact`:

- `atlas impact --diff [--base <ref>] [--repo <id>] [-w <ws>] [--depth N] [--limit N] [--json]`.
- Read `git diff --unified=0 <base>` (default `HEAD`, i.e. uncommitted changes; pass `--base main`
  for a branch's changes) in the target repo, parse the new-side hunk ranges per file.
- Map each changed line to a **function node** via a range heuristic: a function owns
  `[its line, the next function's line)` in the same file. The union of touched functions is the
  set of impact targets.
- Run the existing transitive-caller walk + cross-repo consumer lookup over those targets and
  print the aggregated blast radius (same shape as `atlas impact`, with multiple targets).
- The repo is chosen by `--repo`, else the workspace repo whose path contains the current dir.
  Untracked/new files are skipped (a new function has no callers yet).

No schema change, no core change — `core/impact.ts` is reused as-is. Git is invoked **read-only**
on the target repo; the analysis pipeline still makes no network calls (ADR 0006).

## Consequences
- A PR/CI-friendly "blast radius of this change" using the *exact* graph (no heuristical guess of
  what a diff affects) — pairs naturally with the existing git hooks / search-nudge.
- Best-effort line→node mapping (only function start lines are known, so a function's span is
  approximated to the next function): edits in a file's top-level/inter-function regions may map
  to the nearest preceding function or none. A hint to verify (#5), like every query.
- Stale map → stale impact; `atlas refresh` first, same caveat as all queries.
- The pure mapper (diff hunks + topology → target node ids) is unit-tested without git; the
  end-to-end command is dogfooded on a real repo.
