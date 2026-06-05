/**
 * Git-diff → changed function nodes (ADR 0017). The pure mapper
 * (`changedFunctionIds`) is unit-tested without git; `changedLinesByFile` shells
 * out to `git diff` read-only on the target repo (no network — ADR 0006).
 */

import { execFileSync } from "node:child_process";
import type { ExtractorOutput } from "../core/schema.js";

/** Changed (new-side) line numbers per repo-relative file, from `git diff <base>`. */
export function changedLinesByFile(repoPath: string, base: string): Map<string, Set<number>> {
  let out: string;
  try {
    out = execFileSync("git", ["-C", repoPath, "diff", "--unified=0", "--no-color", base], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`git diff failed in ${repoPath} (base "${base}"): ${err instanceof Error ? err.message : err}`);
  }
  return parseDiff(out);
}

/** Parse unified-0 diff text into file → set of new-side changed line numbers. */
export function parseDiff(diff: string): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/^b\//, "").replace(/\t.*$/, "").trim();
      file = p === "/dev/null" ? undefined : p;
    } else if (line.startsWith("@@") && file) {
      // @@ -old,n +new,m @@  → m new-side lines starting at `new`.
      const m = line.match(/\+(\d+)(?:,(\d+))?/);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count === 0) continue; // pure deletion — no new-side lines
      let set = map.get(file);
      if (!set) map.set(file, (set = new Set()));
      for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return map;
}

/**
 * Function node ids whose source span contains a changed line. A function "owns"
 * `[its start line, the next function's start line)` in the same file (only start
 * lines are known — best-effort, ADR 0017).
 */
export function changedFunctionIds(
  topology: ExtractorOutput,
  changed: Map<string, Set<number>>,
): string[] {
  const byFile = new Map<string, { id: string; line: number }[]>();
  for (const n of topology.nodes) {
    if (n.kind !== "function") continue;
    let list = byFile.get(n.file);
    if (!list) byFile.set(n.file, (list = []));
    list.push({ id: n.id, line: n.line });
  }

  const ids = new Set<string>();
  for (const [file, lines] of changed) {
    const fns = byFile.get(file);
    if (!fns) continue;
    fns.sort((a, b) => a.line - b.line);
    for (let i = 0; i < fns.length; i++) {
      const start = fns[i]!.line;
      const end = i + 1 < fns.length ? fns[i + 1]!.line : Infinity;
      for (const ln of lines) {
        if (ln >= start && ln < end) {
          ids.add(fns[i]!.id);
          break;
        }
      }
    }
  }
  return [...ids];
}
