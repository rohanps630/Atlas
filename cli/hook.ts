/**
 * `atlas hook install [<repo-path>] [-w <ws>] [--event <git-hook>]`
 * `atlas hook uninstall [<repo-path>] [--event <git-hook>]`
 *
 * Installs a git hook in a target repo that runs `atlas refresh -w <ws>` in the
 * background after the chosen event (default: post-commit). This is deterministic
 * regeneration on a trigger (philosophy #5: cheap-to-regenerate beats stale) — NOT
 * background "AI maintains the topology forever" (rejected.md). The hook only
 * writes under the repo's `.git/hooks`, never its tracked source (ADR 0003).
 *
 * Idempotent and non-destructive: the atlas block is delimited by markers, so it
 * updates in place and preserves any existing hook content; uninstall removes only
 * that block.
 */

import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspace } from "./workspace.js";

const TOOL_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ATLAS_BIN = join(TOOL_ROOT, "bin", "atlas.js");
const MARK_START = "# >>> atlas refresh hook >>>";
const MARK_END = "# <<< atlas refresh hook <<<";
const VALID_EVENTS = new Set(["post-commit", "post-merge", "post-checkout", "post-rewrite"]);

export function runHook(args: string[]): number {
  const sub = args[0];
  const opts = parseArgs(args.slice(1));
  if (sub !== "install" && sub !== "uninstall") {
    console.error("usage: atlas hook <install|uninstall> [<repo-path>] [-w <ws>] [--event post-commit]");
    return 1;
  }

  const repoPath = opts.repoPath ?? process.cwd();
  const hooksDir = join(repoPath, ".git", "hooks");
  if (!fs.existsSync(join(repoPath, ".git"))) {
    console.error(`Not a git repo (no .git): ${repoPath}`);
    return 1;
  }
  const event = opts.event ?? "post-commit";
  if (!VALID_EVENTS.has(event)) {
    console.error(`Unsupported --event "${event}". Use one of: ${[...VALID_EVENTS].join(", ")}`);
    return 1;
  }
  const hookFile = join(hooksDir, event);

  if (sub === "uninstall") return uninstall(hookFile, event);

  const ws = resolveWorkspace(opts.workspace);
  if (!ws) return 1;
  return install(hooksDir, hookFile, event, ws);
}

function install(hooksDir: string, hookFile: string, event: string, ws: string): number {
  const block = [
    MARK_START,
    `( "${process.execPath}" "${ATLAS_BIN}" refresh -w "${ws}" >/dev/null 2>&1 & )`,
    MARK_END,
  ].join("\n");

  fs.mkdirSync(hooksDir, { recursive: true });
  let content = fs.existsSync(hookFile) ? fs.readFileSync(hookFile, "utf8") : "";
  if (!content.trim()) content = "#!/bin/sh\n";

  if (content.includes(MARK_START)) {
    content = stripBlock(content) + "\n" + block + "\n";
  } else {
    content = content.replace(/\n*$/, "\n") + "\n" + block + "\n";
  }
  fs.writeFileSync(hookFile, content, "utf8");
  fs.chmodSync(hookFile, 0o755);

  console.error(`installed ${event} hook → refreshes workspace "${ws}" (background) at ${hookFile}`);
  return 0;
}

function uninstall(hookFile: string, event: string): number {
  if (!fs.existsSync(hookFile)) {
    console.error(`No ${event} hook to clean at ${hookFile}`);
    return 0;
  }
  const content = fs.readFileSync(hookFile, "utf8");
  if (!content.includes(MARK_START)) {
    console.error(`No atlas block in ${event} hook; left untouched.`);
    return 0;
  }
  const cleaned = stripBlock(content).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  // If nothing but a shebang remains, remove the file entirely.
  if (cleaned.trim() === "#!/bin/sh") fs.rmSync(hookFile);
  else fs.writeFileSync(hookFile, cleaned, "utf8");
  console.error(`removed atlas block from ${event} hook.`);
  return 0;
}

function stripBlock(content: string): string {
  const re = new RegExp(`\\n*${escapeRe(MARK_START)}[\\s\\S]*?${escapeRe(MARK_END)}\\n*`, "g");
  return content.replace(re, "\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(args: string[]): { repoPath?: string; workspace?: string; event?: string } {
  const out: { repoPath?: string; workspace?: string; event?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workspace" || a === "-w") out.workspace = args[++i];
    else if (a === "--event") out.event = args[++i];
    else if (a && !a.startsWith("-")) out.repoPath ??= a;
  }
  return out;
}
