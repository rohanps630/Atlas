/**
 * `atlas path <A> <B> [--workspace <ws>] [--max <hops>] [--json]`
 *
 * Shortest connection between two symbols/files across the whole workspace —
 * spanning call edges and cross-repo HTTP contracts. One cheap query instead of
 * the agent reading files to trace how two things relate.
 */

import { queryPath } from "./query.js";

export function runPath(args: string[]): number {
  const { from, to, workspace, max, json } = parseArgs(args);
  if (!from || !to) {
    console.error("usage: atlas path <A> <B> [--workspace <ws>] [--max <hops>] [--json]");
    return 1;
  }

  let res;
  try {
    res = queryPath(from, to, workspace, max);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return res.found ? 0 : 2;
  }

  if (!res.found) {
    console.log(`No path found between "${from}" and "${to}".`);
    return 2;
  }

  console.log(`# path: ${from} → ${to}  (${res.hops.length - 1} hops)\n`);
  res.hops.forEach((h, i) => {
    const where = `${h.node.file}:${h.node.line}`;
    if (i === 0) console.log(`  ${h.node.name}   ${where}`);
    else console.log(`  ${arrow(h.via!.kind, h.via!.direction)} ${h.node.name}   ${where}`);
  });
  return 0;
}

function arrow(kind: string, direction: string): string {
  if (kind === "http") return "→ [HTTP]";
  if (kind === "call") return direction === "calls" ? "→ calls" : "← called by";
  if (kind === "import") return direction === "to" ? "→ imports" : "← imported by";
  return `→ [${kind}]`;
}

function parseArgs(args: string[]): {
  from?: string;
  to?: string;
  workspace?: string;
  max?: number;
  json: boolean;
} {
  const positional: string[] = [];
  let workspace: string | undefined;
  let max: number | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workspace" || a === "-w") workspace = args[++i];
    else if (a === "--max") max = Number(args[++i]);
    else if (a === "--json") json = true;
    else if (a && !a.startsWith("-")) positional.push(a);
  }
  return { from: positional[0], to: positional[1], workspace, max, json };
}
