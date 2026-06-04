/**
 * Shared workspace resolution for commands. With no `--workspace`, default to
 * the only workspace in the store; if there are several, ask the user to pick.
 */

import { listWorkspaces } from "./store.js";

export function resolveWorkspace(requested?: string): string | undefined {
  if (requested) return requested;
  const all = listWorkspaces();
  if (all.length === 1) return all[0];
  if (all.length === 0) {
    console.error("No workspaces yet. Run: atlas scan <repo-path>");
    return undefined;
  }
  console.error(`Multiple workspaces: ${all.join(", ")}`);
  console.error("Pick one with --workspace <ws>.");
  return undefined;
}
