# CLI reference

Every `atlas` command, its flags, output, and exit codes. This documents the
**stable CLI contract** (philosophy #9 — the durable surface). Implementation may
churn; this interface should not change without a note here.

```
atlas <command> [args]
```

Run `atlas --help` for the one-line command list, `atlas --version` for the version.

## Global concepts

- **Workspace** — a named scope holding one or more repos and their generated data, at
  `~/.atlas/<workspace>/` (override the store root with the `ATLAS_HOME` env var). One per
  project/system. See [schema.md §1](schema.md).
- **Repo id** — a short stable name for a repo inside a workspace (e.g. `hms-backend`).
- **Defaults** — when only one workspace exists, `-w/--workspace` may be omitted; when a
  workspace has one repo, `--repo` may be omitted. Commands print a clear error listing the
  choices when a selection is ambiguous.
- **Read-only on your code** — atlas never modifies a scanned repo. All generated data goes to
  the data store (ADR 0003). The only files atlas writes into a *target* repo are ones you opt
  into via `atlas hook` (git hooks / a `.claude/settings.json` nudge) — never source.
- **No network** — the analysis pipeline makes no network calls (ADR 0006).

## Commands

### `atlas menu`
An interactive, numbered menu over the common actions (status, context, impact, path,
endpoints, scan, refresh, agent, detect). Pick a number; it prompts for the few inputs each
needs (picking a workspace from a list) and runs it, then loops. `0`/`q`/Ctrl-D quits. Running
bare `atlas` in a terminal opens this menu; piped/non-interactive `atlas` prints help instead.

### `atlas status [<workspace>]`
The dashboard. Prints version, schema version, data-store path, current phase, then every
workspace with its repos, per-repo counts (functions · calls · consumes · exposes), per-repo
language breakdown, call-resolution coverage (the share of in-repo calls that resolved into the
graph — a hint for how complete `impact`/`path` are; ADR 0013), when each was last scanned,
cross-repo link / external-endpoint totals, and whether the agent docs are generated. Pass a
workspace name to show only that one.

### `atlas detect <repo-path> [--json]`
Print the stack atlas infers for a repo — languages, frameworks, suggested role, workspace
type, and the signals behind them — without scanning. Useful to preview what `scan` will do.
(ADR 0009.)

### `atlas scan <repo-path> [--id <id>] [--workspace <ws>] [--role fe|be|lib|tool] [--type freelance|company]`
Extract a repo and write its topology to the workspace, then re-link the workspace and
regenerate the merged map.
- Auto-detects languages present (TypeScript/JS, Swift, Kotlin, Go) and runs the matching
  extractors, merging into one topology.
- Auto-fills `--role` and `--type` from detection when omitted (override with the flags).
- `--id` defaults to the directory name; `--workspace` defaults to the id.

### `atlas context <symbol|file> [--workspace <ws>] [--repo <id>] [--json]`
A focused context pack: the target plus its direct callers and callees. Resolves the query as a
node id, then a symbol name, then a file path (a file query returns the file's functions).
Exit `2` if nothing matched.

### `atlas impact <symbol|file> [--workspace <ws>] [--repo <id>] [--depth N] [--limit N] [--json]`
"If I change this, what breaks?" — transitive intra-repo callers plus cross-repo consumers
(via the merged map). `--depth` bounds how far callers are walked; `--limit` caps how many are
returned (prints "+N more"). Exit `2` if unresolved.

**`atlas impact --diff [--base <ref>] [--repo <id>] [-w <ws>] [--depth N] [--limit N] [--json]`**
— the blast radius of a whole change (ADR 0017). Reads `git diff <base>` (default `HEAD`;
`--base main` for a branch's changes) in the repo, maps changed lines to the functions that own
them, and runs impact over all of them. The repo is `--repo`, else the workspace repo containing
the current dir. Prints nothing affected (exit `0`) when the diff touches no mapped functions.

### `atlas viz [--workspace <ws>] [--repo <id>] [--out <file>]`
Render an **interactive, self-contained HTML** map of the workspace (ADR 0018), built on
Cytoscape.js (vendored + inlined; no CDN/network, opens offline, NDA-safe). A **compound
hierarchy you click to drill into**: the top level is just the repos, joined by one weighted
arrow per repo pair (labelled with the contract count — click it to list the contracts); click a
repo to expand into its modules (directories), then functions. Expand/Collapse-all + a search box;
nodes coloured by repo. `--repo <id>` scopes to one repo; `--out` redirects the file (default
`~/.atlas/<ws>/graph.html`). A richer companion to `architecture.md`'s static Mermaid diagram.

### `atlas path <A> <B> [--workspace <ws>] [--max <hops>] [--json]`
Shortest connection between two symbols/files across the whole workspace — spanning call edges
and cross-repo HTTP contracts. Answers "how does A reach B" in one query. `--max` caps path
length (default 12). Exit `2` if no path.

### `atlas endpoints [--workspace <ws>] [--json]`
The workspace HTTP surface: resolved cross-repo links (FE consume ↔ BE expose) and external
endpoints (consumed but exposed by no repo in the workspace — the "missing backends" list).

### `atlas agent [--workspace <ws>]`
Generate the agent artifacts into the data store and print wiring instructions:
- `architecture.md` — orientation (hubs, suggested questions), conventions (per-layer naming +
  exemplar file), call-resolution coverage (ADR 0013), landmines (TODO/FIXME/HACK/WHY), the
  Mermaid system diagram, and externals.
- `atlas.steering.md` — always-on agent context (what atlas is, when to use it, the detected
  stack). Wire it into a repo's `CLAUDE.md` with `@<path>`.

### `atlas refresh [--workspace <ws>]`
Re-scan every repo in the workspace manifest, re-link, and regenerate the agent docs — one
command. A repo whose path no longer exists is skipped, not an error.

### `atlas mcp`
Run the MCP server (stdio) that serves the map to coding agents. Register once with
`claude mcp add atlas -- node <abs>/bin/atlas.js mcp` (use `-s user` for all projects).
Tools: `atlas_context`, `atlas_callers`, `atlas_impact`, `atlas_endpoints`, `atlas_path`,
`atlas_neighborhood`. Read-only, no network. (ADR 0006.)

### `atlas hook <subcommand>`
- `atlas hook install [<repo>] [-w <ws>] [--event post-commit]` — install a git hook that runs
  `atlas refresh -w <ws>` in the background after the chosen event (so the map self-updates on
  commit). Idempotent, preserves any existing hook, writes only under `.git/hooks`.
- `atlas hook uninstall [<repo>] [--event post-commit]` — remove the atlas block.
- `atlas hook search-nudge [<repo>] [-w <ws>] [--remove]` — merge (or remove) a Claude Code
  PreToolUse hook into `<repo>/.claude/settings.json` that reminds the agent to query atlas
  before raw Grep/Glob. Best-effort.

## Exit codes
- `0` success · `1` usage / bad input · `2` query resolved nothing (`context`/`impact`/`path`)
- `3` command needs a build (`npm run build`)

## Typical flows

```bash
# one repo
atlas scan /path/to/repo -w app           # detect + scan (no flags needed)
atlas context useAuth -w app
atlas impact useAuth -w app --limit 20

# add a backend → cross-repo links light up
atlas scan /path/to/api -w app            # role auto-detected
atlas endpoints -w app
atlas path LoginScreen LoginHandler -w app

# wire an agent + keep it fresh
atlas agent -w app                        # then add the printed @import to the repo's CLAUDE.md
claude mcp add atlas -s user -- node <abs>/bin/atlas.js mcp
atlas hook install /path/to/repo -w app   # auto-refresh on commit
```
