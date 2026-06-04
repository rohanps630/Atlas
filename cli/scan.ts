/**
 * `atlas scan <repo-path> [--id <repoId>]`
 *
 * Runs the TypeScript extractor over a repo and writes its topology to the
 * data store. The target repo is read-only (never modified); output goes only
 * to ~/.atlas (ADR 0003). Thin: parse args, call the extractor, write, report.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { extractRepo } from "../extractors/typescript/index.js";
import { writeTopology } from "./store.js";

export function runScan(args: string[]): number {
  const { repoPath, repoId } = parseArgs(args);
  if (!repoPath) {
    console.error("usage: atlas scan <repo-path> [--id <repoId>]");
    return 1;
  }

  const abs = path.resolve(repoPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    console.error(`Not a directory: ${abs}`);
    return 1;
  }

  const id = repoId ?? path.basename(abs);
  console.error(`scanning ${abs} as "${id}" …`);
  const start = Date.now();
  const output = extractRepo({ repoPath: abs, repoId: id });
  const file = writeTopology(output);
  const ms = Date.now() - start;

  const fnCount = output.nodes.filter((n) => n.kind === "function").length;
  const callCount = output.edges.filter((e) => e.kind === "call").length;
  const importCount = output.edges.filter((e) => e.kind === "import").length;
  console.error(
    `done in ${ms}ms: ${fnCount} functions, ${callCount} calls, ${importCount} imports`,
  );
  console.error(`wrote ${file}`);
  return 0;
}

function parseArgs(args: string[]): { repoPath?: string; repoId?: string } {
  let repoPath: string | undefined;
  let repoId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--id") repoId = args[++i];
    else if (a && !a.startsWith("-")) repoPath ??= a;
  }
  return { repoPath, repoId };
}
