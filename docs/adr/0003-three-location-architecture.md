# 0003 - Tool repo, data store, and target repos are three separate locations

Status: Accepted

## Context
This is a long-lived personal tool used across many client and company repos. Generated data
and client code must never pollute the tool's git history, and the tool must never modify the
repos it analyzes (especially client repos under NDA).

## Decision
Three distinct locations, never conflated:

1. **Tool repo** (this repo) — code, docs, tiny test fixtures. Owned, versioned, long-lived.
2. **Data store** — `~/.atlas/<workspace>/` — generated manifests, topology, packs.
   Per-workspace, never committed anywhere.
3. **Target repos** — client/company code, referenced by absolute path in the manifest.
   Read-only; never copied, never modified.

## Consequences
- The tool repo stays clean and portable; you can clone it onto any machine.
- Client code never enters the tool repo or any index.
- Deleting a client checkout doesn't lose your accumulated map (it's in the data store).
- `.gitignore` and the data-store path must enforce this boundary; fixtures are the only
  sample code allowed in the tool repo.
