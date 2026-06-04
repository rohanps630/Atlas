# Philosophy — the principles that decide trade-offs

When a design question comes up, resolve it against these. They are ordered roughly by how
often they settle an argument. If a proposed feature violates one of these, that is a strong
signal to stop — write an ADR before overriding it.

### 1. The agent brings the search; the tool brings the map.
Coding agents already do on-demand discovery (grep/glob/read) better than any index we
could build. We do not compete with that. We provide the cross-repo, whole-system structure
the agent *cannot* cheaply reconstruct by searching.

### 2. Structured precision over fuzzy similarity.
"Who calls X" and "what breaks if I change Y" are graph questions with exact answers. We
never answer them with approximate nearest-neighbor similarity. No embeddings.

### 3. Local-only. Nothing leaves the machine.
No cloud calls in the pipeline, no stored copy of code to leak. This is what makes the tool
safe to point at NDA'd client code.

### 4. The unknown is a first-class node, not an error.
When the FE calls an endpoint no available repo exposes, we record an `external` node — not
a crash, not a silent drop. When that repo later joins the manifest, the edge resolves.
This is what lets one tool span 1 repo to 22.

### 5. Generated data is a hint, not truth.
Topology can drift from source. The agent and I treat the map as a guide to verify against
real code, never as authority. Cheap to regenerate beats trusted-but-stale.

### 6. Repo-local first; cross-repo is an optional layer.
Everything valuable in a single repo works standalone. Cross-repo linking is a layer on top
that simply produces nothing when there's one repo. Adding repos lights up more of the map;
nothing breaks.

### 7. The manifest defines scope. Same tool, different manifest.
The tool never hardcodes a project shape. What it analyzes is whatever the manifest lists.

### 8. Thin extractors, fat language-agnostic core.
Per-language extractors do the minimum: read source, emit normalized JSON. The core (graph,
linker, impact, context packs) only ever consumes that JSON, so it never learns a language.
Adding a language never touches the core.

### 9. Document the durable; let the volatile self-document.
Heavily document the schema, the decisions (ADRs), and the contracts. Don't heavily document
churning implementation — code and tests carry that. Rewrite docs only when a *contract* changes.

### 10. Small and dogfooded beats complete and theoretical.
Every milestone must be something I actually run on a real repo. A tiny tool I use daily is
worth more than a grand architecture I never finish. Scope creep is the primary failure mode.
