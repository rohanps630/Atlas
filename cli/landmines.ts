/**
 * Landmine scan: collect `TODO/FIXME/HACK/XXX/BUG/WHY/NOTE` comments across a
 * workspace's repos. Surfaced in `architecture.md` so an agent sees the known
 * caveats/rationale before changing nearby code (fewer mistakes) — the useful,
 * deterministic slice of graphify's "the why", with no schema change.
 *
 * Bounded (file + match caps) so it adds little to `agent`/`refresh`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Landmine {
  repo: string;
  file: string;
  line: number;
  marker: string;
  text: string;
}

const MARKER_RE = /(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK|XXX|BUG|WHY|NOTE)\b[:\-\s]\s*(.+)/;
const SRC_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".go", ".kt", ".swift", ".py", ".rb", ".java", ".rs"]);
const IGNORE_DIRS = new Set([
  "node_modules", "Pods", "build", ".gradle", "DerivedData", "dist", ".next",
  ".git", ".expo", "Carthage", "vendor", "bin",
]);

export function collectLandmines(
  repos: { id: string; path: string }[],
  opts: { limit?: number; maxFiles?: number } = {},
): Landmine[] {
  const limit = opts.limit ?? 50;
  const maxFiles = opts.maxFiles ?? 1500;
  const out: Landmine[] = [];
  let scanned = 0;

  for (const repo of repos) {
    const root = path.resolve(repo.path);
    const stack = [root];
    while (stack.length > 0) {
      if (out.length >= limit || scanned >= maxFiles) return out;
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORE_DIRS.has(e.name)) stack.push(full);
        } else if (e.isFile() && SRC_EXTS.has(path.extname(e.name))) {
          if (scanned >= maxFiles) return out;
          scanned++;
          scanFile(full, root, repo.id, out, limit);
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

function scanFile(file: string, root: string, repoId: string, out: Landmine[], limit: number): void {
  let lines: string[];
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch {
    return;
  }
  const rel = file.slice(root.length + 1).split(path.sep).join("/");
  for (let i = 0; i < lines.length; i++) {
    const m = MARKER_RE.exec(lines[i]!);
    if (m) {
      out.push({ repo: repoId, file: rel, line: i + 1, marker: m[1]!.toUpperCase(), text: m[2]!.trim().slice(0, 160) });
      if (out.length >= limit) return;
    }
  }
}
