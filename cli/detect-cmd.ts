/**
 * `atlas detect <repo-path> [--json]`
 *
 * Print the detected stack for a repo (languages, frameworks, suggested role +
 * type, and the signals behind them). Handy for checking what `scan` will infer
 * before committing to a workspace. Read-only; touches nothing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { detectStack } from "./detect.js";

export function runDetect(args: string[]): number {
  const json = args.includes("--json");
  const target = args.find((a) => !a.startsWith("-"));
  if (!target) {
    console.error("usage: atlas detect <repo-path> [--json]");
    return 1;
  }
  const abs = path.resolve(target);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    console.error(`Not a directory: ${abs}`);
    return 1;
  }

  const d = detectStack(abs);
  if (json) {
    console.log(JSON.stringify(d, null, 2));
    return 0;
  }
  console.log(`# detected stack — ${abs}\n`);
  console.log(`languages:  ${d.languages.join(", ") || "(none)"}`);
  console.log(`frameworks: ${d.frameworks.join(", ") || "(none)"}`);
  console.log(`role:       ${d.role}`);
  console.log(`type:       ${d.type}`);
  console.log(`signals:    ${d.signals.join(", ") || "(none)"}`);
  return 0;
}
