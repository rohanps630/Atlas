/**
 * `atlas menu` — an interactive, numbered menu over the existing commands, for
 * when you don't want to remember flags. Pure UX: it prompts for the few inputs
 * each action needs (picking a workspace from a list) and delegates to the same
 * run* functions the CLI uses. Bare `atlas` in a terminal lands here.
 */

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { listWorkspaces, reposInWorkspace } from "./store.js";
import { runStatus } from "./status.js";
import { runScan } from "./scan.js";
import { runContext } from "./context.js";
import { runImpact } from "./impact.js";
import { runPath } from "./path.js";
import { runEndpoints } from "./endpoints.js";
import { runRefresh } from "./refresh.js";
import { runAgent } from "./agent.js";
import { runDetect } from "./detect-cmd.js";

interface Item {
  label: string;
  run: (rl: readline.Interface) => Promise<void> | void;
}

const ITEMS: Item[] = [
  { label: "Status dashboard", run: () => void runStatus([]) },
  {
    label: "Context for a symbol/file (callers + callees)",
    run: async (rl) => {
      const ws = await pickWorkspace(rl);
      if (!ws) return;
      const q = (await rl.question("symbol or file: ")).trim();
      if (q) runContext(["-w", ws, q]);
    },
  },
  {
    label: "Impact of a change (what breaks)",
    run: async (rl) => {
      const ws = await pickWorkspace(rl);
      if (!ws) return;
      const q = (await rl.question("symbol or file: ")).trim();
      if (q) runImpact(["-w", ws, q]);
    },
  },
  {
    label: "Path between two symbols (cross-repo)",
    run: async (rl) => {
      const ws = await pickWorkspace(rl);
      if (!ws) return;
      const a = (await rl.question("from: ")).trim();
      const b = (await rl.question("to: ")).trim();
      if (a && b) runPath(["-w", ws, a, b]);
    },
  },
  {
    label: "Endpoints (cross-repo links + external)",
    run: async (rl) => {
      const ws = await pickWorkspace(rl);
      if (ws) runEndpoints(["-w", ws]);
    },
  },
  {
    label: "Scan a repo into a workspace",
    run: async (rl) => {
      const path = (await rl.question("repo path: ")).trim();
      if (!path) return;
      const ws = (await rl.question("workspace (blank = use repo name): ")).trim();
      runScan(ws ? [path, "-w", ws] : [path]);
    },
  },
  {
    label: "Refresh a workspace (re-scan + re-link + regenerate)",
    run: async (rl) => {
      const ws = await pickWorkspace(rl);
      if (ws) runRefresh(["-w", ws]);
    },
  },
  {
    label: "Generate agent docs (steering + architecture.md)",
    run: async (rl) => {
      const ws = await pickWorkspace(rl);
      if (ws) runAgent(["-w", ws]);
    },
  },
  {
    label: "Detect a repo's stack (no scan)",
    run: async (rl) => {
      const path = (await rl.question("repo path: ")).trim();
      if (path) runDetect([path]);
    },
  },
];

export async function runMenu(): Promise<number> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      console.log("\natlas — pick an action:\n");
      ITEMS.forEach((it, i) => console.log(`  ${i + 1}. ${it.label}`));
      console.log(`  0. Quit`);
      let choice: string;
      try {
        choice = (await rl.question("\n> ")).trim();
      } catch {
        break; // stdin closed (EOF / Ctrl-D)
      }
      if (choice === "0" || choice.toLowerCase() === "q") break;
      const idx = Number(choice) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= ITEMS.length) {
        console.log("Enter a number from the list.");
        continue;
      }
      try {
        await ITEMS[idx]!.run(rl);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

/** Pick a workspace: auto if one, numbered prompt if several, message if none. */
async function pickWorkspace(rl: readline.Interface): Promise<string | undefined> {
  const all = listWorkspaces();
  if (all.length === 0) {
    console.log("No workspaces yet — scan a repo first.");
    return undefined;
  }
  if (all.length === 1) return all[0];
  console.log("workspaces:");
  all.forEach((w, i) => console.log(`  ${i + 1}. ${w}  (${reposInWorkspace(w).length} repos)`));
  const pick = (await rl.question("workspace #: ")).trim();
  const idx = Number(pick) - 1;
  if (Number.isInteger(idx) && idx >= 0 && idx < all.length) return all[idx];
  if (all.includes(pick)) return pick;
  console.log("Invalid choice.");
  return undefined;
}
