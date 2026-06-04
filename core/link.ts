/**
 * Cross-repo linker (core, pure — ADR 0005).
 *
 * Merges per-repo extractor outputs into the §3 map by matching FE `consumes`
 * against BE `exposes` on HTTP contract (method + normalized path). The
 * degradation rule (principle #4): a consume with no matching expose becomes an
 * `external` node, never an error — so the linker works at 1 repo or 22, and a
 * missing backend simply shows up as the set of endpoints the FE depends on.
 */

import type {
  CrossRepoEdge,
  ExternalNode,
  ExtractorOutput,
  MergedMap,
} from "./schema.js";

/**
 * Normalize a route for contract matching: strip path-param *names* so a FE's
 * `/api/orders/:id` matches a BE's `/api/orders/{id}`. Both collapse to `{}`.
 */
export function normalizePath(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, "{}") // template `${x}`
    .replace(/:[^/]+/g, "{}") // express `:id`
    .replace(/\{[^/}]+\}/g, "{}"); // brace `{id}`
}

/** The contract key two repos must agree on to link. */
export function contractOf(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

/**
 * A path is matchable only if it's a real route (absolute or a URL). Symbolic
 * paths — e.g. `resolveSlug("auth","register")` — are not statically resolvable
 * here and can never match an `exposes`, so they always stay `external`.
 */
export function isRoute(path: string): boolean {
  return /^(\/|https?:\/\/)/.test(path);
}

export function linkRepos(
  outputs: ExtractorOutput[],
  opts: { workspace: string; generatedAt: string },
): MergedMap {
  // Index every exposed endpoint by contract.
  const exposesByContract = new Map<string, string>(); // contract -> handler id
  for (const out of outputs) {
    for (const e of out.endpoints.exposes) {
      exposesByContract.set(contractOf(e.method, e.path), e.handler);
    }
  }

  const crossRepoEdges: CrossRepoEdge[] = [];
  // external contract -> set of consumer node ids
  const externalConsumers = new Map<string, Set<string>>();

  for (const out of outputs) {
    for (const c of out.endpoints.consumes) {
      // Symbolic (non-route) paths can never match an expose — always external.
      const routy = isRoute(c.path);
      const contract = routy
        ? contractOf(c.method, c.path)
        : `${c.method.toUpperCase()} ${c.path}`;

      const handler = routy ? exposesByContract.get(contract) : undefined;
      if (handler) {
        crossRepoEdges.push({ from: c.from, to: handler, kind: "http", contract });
      } else {
        let set = externalConsumers.get(contract);
        if (!set) externalConsumers.set(contract, (set = new Set()));
        set.add(c.from);
      }
    }
  }

  const externalNodes: ExternalNode[] = [...externalConsumers.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([contract, consumers]) => ({
      id: `external:${contract}`,
      reason: "consumed but no repo in the manifest exposes it",
      consumedBy: [...consumers].sort(),
    }));

  return {
    schemaVersion: outputs[0]?.schemaVersion ?? 0,
    workspace: opts.workspace,
    generatedAt: opts.generatedAt,
    repos: outputs.map((o) => o.repo),
    crossRepoEdges,
    externalNodes,
  };
}
