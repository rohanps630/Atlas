# 0004 - The manifest defines scope; missing repos degrade gracefully

Status: Accepted

## Context
The tool must work unchanged across 1 repo (freelance) to 22 repos (company), and across
partial access (some backends available, some not). Hardcoding any project shape would break
this. Erroring when a referenced service isn't available would make partial access unusable.

## Decision
- What the tool analyzes is exactly what the manifest lists — nothing auto-assumed.
- The intra-repo layer always works standalone; the cross-repo layer is additive.
- Any reference to something outside the manifest becomes an `external` node, never an error.
  When that repo is added later, the next merge resolves it automatically (see schema.md §3).

## Consequences
- One tool, many shapes — only the manifest changes between contexts.
- Partial access is a normal, supported state, not a degraded one.
- The "unknown" surface is itself useful output (e.g., the list of external backends a lone
  frontend depends on).
- Requires discipline: never write code that assumes a repo is present.
