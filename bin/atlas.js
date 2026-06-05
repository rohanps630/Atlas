#!/usr/bin/env node
// atlas CLI entry. Routes commands to compiled implementations in dist/cli/
// (build with `npm run build`). status/help run with no build step.
// See docs/phases.md for what each command does, and AGENTS.md before extending.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = "0.1.0";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Command registry. `available: false` commands are declared so the roadmap is visible
// from the CLI itself, but they are not implemented yet.
const COMMANDS = {
  status:   { phase: 0, available: true,  desc: "Show tool version, phase, and data-store location" },
  detect:   { phase: 4, available: true,  desc: "Detect a repo's languages, frameworks, and role" },
  scan:     { phase: 1, available: true,  desc: "Scan a repo (auto-detects stack) and write its topology" },
  context:  { phase: 1, available: true,  desc: "Emit a focused context pack (target + callers + callees)" },
  impact:   { phase: 2, available: true,  desc: "Show what a change to <target> affects (intra + cross-repo)" },
  path:     { phase: 2, available: true,  desc: "Shortest connection between two symbols/files (cross-repo)" },
  endpoints:{ phase: 2, available: true,  desc: "List cross-repo links and external (unmatched) endpoints" },
  mcp:      { phase: 3, available: true,  desc: "Run the MCP server that serves the map to agents (stdio)" },
  agent:    { phase: 3, available: true,  desc: "Generate agent steering + architecture.md and print wiring" },
  refresh:  { phase: 3, available: true,  desc: "Re-scan all repos in a workspace, re-link, regenerate agent files" },
  hook:     { phase: 3, available: true,  desc: "Install/uninstall a git hook that refreshes a workspace on commit" },
};

// Compiled command modules live under dist/cli/ after `npm run build`.
const ROUTES = {
  scan:      { mod: "dist/cli/scan.js",      fn: "runScan" },
  context:   { mod: "dist/cli/context.js",   fn: "runContext" },
  endpoints: { mod: "dist/cli/endpoints.js", fn: "runEndpoints" },
  impact:    { mod: "dist/cli/impact.js",    fn: "runImpact" },
  path:      { mod: "dist/cli/path.js",      fn: "runPath" },
  mcp:       { mod: "dist/mcp/server.js",    fn: "runMcp" },
  agent:     { mod: "dist/cli/agent.js",     fn: "runAgent" },
  refresh:   { mod: "dist/cli/refresh.js",   fn: "runRefresh" },
  detect:    { mod: "dist/cli/detect-cmd.js", fn: "runDetect" },
  hook:      { mod: "dist/cli/hook.js",      fn: "runHook" },
};

async function route(cmd, args) {
  const r = ROUTES[cmd];
  const modPath = join(ROOT, r.mod);
  if (!existsSync(modPath)) {
    console.error(`'${cmd}' needs a build. Run: npm run build`);
    process.exit(3);
  }
  const mod = await import(pathToFileURL(modPath).href);
  const code = await mod[r.fn](args);
  process.exit(code ?? 0);
}

const DATA_STORE = process.env.ATLAS_HOME
  || `${process.env.HOME || "~"}/.atlas`;

function printHelp() {
  console.log(`atlas ${VERSION}
The agent brings the search; this tool brings the map.

Usage: atlas <command> [args]

Commands:`);
  for (const [name, c] of Object.entries(COMMANDS)) {
    const tag = c.available ? "" : `  (Phase ${c.phase} — not yet implemented)`;
    console.log(`  ${name.padEnd(10)} ${c.desc}${tag}`);
  }
  console.log(`
Docs: start with README.md, then AGENTS.md if you're an agent continuing development.`);
}

function printStatus() {
  console.log(`atlas ${VERSION}`);
  console.log(`data store:   ${DATA_STORE}`);
  console.log(`current phase: 1 — single-repo core ('scan' + 'context')`);
  console.log(`next phase:    2 — manifest, cross-repo links, 'impact'`);
  console.log(`see docs/phases.md for the roadmap.`);
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  printHelp();
  process.exit(0);
}
if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const entry = COMMANDS[cmd];
if (!entry) {
  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  process.exit(1);
}
if (cmd === "status") {
  printStatus();
  process.exit(0);
}
if (!entry.available) {
  console.error(`'${cmd}' is planned for Phase ${entry.phase} and isn't implemented yet.`);
  console.error(`See docs/phases.md. If you're building it, read AGENTS.md first.`);
  process.exit(2);
}
if (ROUTES[cmd]) {
  await route(cmd, args);
}
