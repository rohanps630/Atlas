# How atlas works

A durable, end-to-end overview of the pipeline and why it's shaped this way. For the *why*
behind individual decisions see [`adr/`](adr/); for the data contract see [`schema.md`](schema.md);
for commands see [`cli.md`](cli.md).

## The one idea
Coding agents already search within a repo well (grep/glob/read). They're bad at seeing the
*shape of a system across repos*. atlas builds exactly that — a precise, local, cross-repo
**structural map** — and serves it to the agent. It does not do semantic search or embeddings
(ADR 0001); it answers graph questions with exact answers (philosophy #2).

## The three locations (ADR 0003)
1. **Tool repo** (this repo) — code, docs, tiny fixtures. Versioned, long-lived.
2. **Data store** — `~/.atlas/<workspace>/` (override with `ATLAS_HOME`) — all generated data.
   Never committed.
3. **Target repos** — your code, referenced by absolute path in the manifest. Read-only.

## The pipeline

```
            detect            extract (per language)          merge / link              serve
repo ──▶ languages,    ──▶ ts-morph (TS/JS) ─┐           ┌▶ one graph per repo   ──▶ CLI: context/impact/path/endpoints
         frameworks,       tree-sitter (Swift,│           │  + cross-repo HTTP        MCP server (6 tools)
         role, type        Kotlin, Go) ───────┴─ normalized│  contract edges          architecture.md + steering
                            JSON (schema §2)   merge per   │                          (orientation, conventions,
                                               repo ───────┘  external nodes for       landmines, mermaid)
                                                              unmatched consumes
```

1. **Detect** (`cli/detect.ts`, ADR 0009) reads dependency manifests, config, build files, and
   file extensions to infer languages, frameworks, role (`fe`/`be`/…), and workspace type. This
   auto-configures `scan`.
2. **Extract** — one extractor per language, each emitting the **same normalized JSON**
   (schema.md §2): `function`/`module` nodes, `call`/`import` edges, and HTTP `consumes`/
   `exposes`. TypeScript uses ts-morph; Swift/Kotlin/Go use tree-sitter (ADR 0008/0010). A repo
   can hold several languages (e.g. an RN app with native modules) — outputs are merged into one
   topology (`cli/extract.ts`).
3. **Link** (`core/link.ts`) — the core merges all repos' topologies and matches FE `consumes`
   to BE `exposes` by **HTTP contract** (method + param-normalized path). A consume with no
   match becomes an `external` node, never an error — so the same tool works at 1 repo or 22,
   and a missing backend shows up as the list of endpoints you depend on (principle #4).
4. **Serve** — three surfaces over the same data:
   - **CLI**: `context`, `impact`, `path`, `endpoints`, `status` (see cli.md).
   - **MCP server** (`atlas mcp`): the same queries as agent tools, read-only, no network.
   - **Agent docs** (`atlas agent`): `architecture.md` (orientation/conventions/landmines/
     diagram) + `atlas.steering.md` (always-on context), wired into a repo's `CLAUDE.md`.

## The extractor / core boundary (ADR 0005)
This is the load-bearing seam. Extractors are per-language and may take dependencies and churn;
the **core** (graph, linker, impact, path, neighborhood, orientation, conventions) consumes
**only** the normalized JSON and never sees source. Adding a language = adding an extractor; the
core is untouched. This has held across TypeScript, Swift, Kotlin, and Go.

## Data store layout
```
~/.atlas/<workspace>/
  manifest.json              scope: which repos (id, path, role, language) — schema §1
  <repo>.topology.json       per-repo nodes/edges/endpoints — schema §2
  <repo>.detection.json      detected stack (generated; not a schema contract)
  map.json                   merged cross-repo map — schema §3
  architecture.md            agent-readable overview (generated)
  atlas.steering.md          always-on agent context (generated)
```

## Freshness (philosophy #5)
The map is a **hint to verify against real code**, never authority — it can drift. atlas makes
regeneration cheap (`atlas refresh`, ~seconds) rather than pretending to stay live. It never
does background "AI maintains the topology forever" (rejected.md); the optional `atlas hook`
just runs `refresh` deterministically on commit if you want it.

## What atlas deliberately is not
No embeddings/vector DB (ADR 0001), no LLM/semantic layer or network in the pipeline
(ADR 0006), no health scores or speculative audits (rejected.md), no whole-repo context dumps.
It stays a sharp, exact, local map. New capabilities are added only when a real, recurring need
appears — and never by re-adding a rejected idea without a superseding ADR.
