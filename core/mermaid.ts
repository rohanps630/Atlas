/**
 * Mermaid diagram of the merged map (pure — consumes the §3 map only).
 *
 * Renders the *system contract wiring*: one subgraph per repo, the nodes that
 * participate in cross-repo links, solid edges for resolved contracts, and
 * dashed edges to `external` endpoints (consumed but not exposed here). Bounded
 * by design — only contract-involved nodes appear, never the whole call graph.
 */

import type { MergedMap } from "./schema.js";

export function systemDiagram(map: MergedMap): string {
  const lines = ["flowchart LR"];
  const idOf = new Map<string, string>();
  let counter = 0;
  const nodeId = (full: string): string => {
    let id = idOf.get(full);
    if (!id) idOf.set(full, (id = `n${counter++}`));
    return id;
  };

  // Collect participating nodes grouped by repo.
  const byRepo = new Map<string, Set<string>>();
  const add = (full: string) => {
    const repo = repoOf(full);
    let set = byRepo.get(repo);
    if (!set) byRepo.set(repo, (set = new Set()));
    set.add(full);
  };
  for (const e of map.crossRepoEdges) {
    add(e.from);
    add(e.to);
  }
  for (const n of map.externalNodes) {
    add(n.id); // "external:METHOD /path"
    for (const c of n.consumedBy) add(c);
  }

  if (byRepo.size === 0) return `${lines[0]}\n  empty["no cross-repo links yet"]`;

  for (const [repo, fulls] of byRepo) {
    lines.push(`  subgraph ${sanitizeId(repo)}["${esc(repo)}"]`);
    for (const f of fulls) lines.push(`    ${nodeId(f)}["${esc(label(f))}"]`);
    lines.push("  end");
  }
  for (const e of map.crossRepoEdges) {
    lines.push(`  ${nodeId(e.from)} -->|"${esc(e.contract)}"| ${nodeId(e.to)}`);
  }
  for (const n of map.externalNodes) {
    const contract = n.id.replace(/^external:/, "");
    for (const c of n.consumedBy) {
      lines.push(`  ${nodeId(c)} -.->|"${esc(contract)}"| ${nodeId(n.id)}`);
    }
  }
  return lines.join("\n");
}

function repoOf(full: string): string {
  if (full.startsWith("external:")) return "external";
  const i = full.indexOf(":");
  return i > 0 ? full.slice(0, i) : "?";
}

/** Human label: drop the repo prefix, keep file#symbol (or the contract). */
function label(full: string): string {
  if (full.startsWith("external:")) return full.slice("external:".length);
  const i = full.indexOf(":");
  return i > 0 ? full.slice(i + 1) : full;
}

function sanitizeId(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, "_") || "x";
}

/** Mermaid quoted-label safe: drop double quotes and collapse whitespace. */
function esc(s: string): string {
  return s.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}
