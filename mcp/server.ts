/**
 * Atlas MCP server (Phase 3) — serves the structured map to coding agents.
 *
 * Read-only over the data store (~/.atlas); makes no network calls (ADR 0006 —
 * stdio is local). Exposes the four map queries an agent can't cheaply derive by
 * searching: `context`, `callers`, `impact`, `endpoints`. The agent still does
 * its own in-repo discovery (philosophy #1); these answer the cross-repo and
 * call-graph questions only.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  queryCallers,
  queryContext,
  queryEndpoints,
  queryImpact,
  queryNeighborhood,
  queryPath,
} from "../cli/query.js";

const wsProp = {
  workspace: { type: "string", description: "Workspace name (omit if only one exists)." },
};
const repoProp = {
  repo: { type: "string", description: "Repo id within the workspace (omit if only one)." },
};

const TOOLS = [
  {
    name: "atlas_context",
    description:
      "Focused context pack for a symbol or file: the target plus its direct callers and callees. Use when orienting in unfamiliar code or before editing a function.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A symbol name, file path, or full node id." },
        ...wsProp,
        ...repoProp,
      },
      required: ["query"],
    },
  },
  {
    name: "atlas_callers",
    description:
      "Direct callers of a symbol (reverse call edges). Use to gauge the immediate blast radius of changing a function.",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string" }, ...wsProp, ...repoProp },
      required: ["symbol"],
    },
  },
  {
    name: "atlas_impact",
    description:
      "What a change affects: all transitive intra-repo callers, plus cross-repo consumers of any endpoint the target handles. Use before refactors, renames, or deletes.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "A symbol name, file path, or node id." },
        ...wsProp,
        ...repoProp,
      },
      required: ["target"],
    },
  },
  {
    name: "atlas_endpoints",
    description:
      "The workspace HTTP surface: resolved cross-repo links (FE consume ↔ BE expose) and external endpoints (consumed but not exposed by any repo here). Use for cross-repo / backend-dependency questions.",
    inputSchema: { type: "object", properties: { ...wsProp } },
  },
  {
    name: "atlas_path",
    description:
      "Shortest connection between two symbols/files across the whole workspace — spanning call edges and cross-repo HTTP contracts. Use to answer 'how does A reach B?' in one query instead of reading files.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start symbol, file, or node id." },
        to: { type: "string", description: "End symbol, file, or node id." },
        ...wsProp,
        maxHops: { type: "number", description: "Max path length (default 12)." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "atlas_neighborhood",
    description:
      "The local call subgraph around a symbol (its callers + callees to a given depth) in one bounded call — use to understand 'what's around this' without separate context/impact queries.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        depth: { type: "number", description: "Hops out from the symbol (default 1)." },
        ...wsProp,
        ...repoProp,
      },
      required: ["symbol"],
    },
  },
] as const;

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const server = new Server(
  { name: "atlas", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  const args = a as Record<string, string | undefined>;
  try {
    switch (name) {
      case "atlas_context":
        return ok(queryContext(args.query!, args.workspace, args.repo));
      case "atlas_callers":
        return ok(queryCallers(args.symbol!, args.workspace, args.repo));
      case "atlas_impact":
        return ok(queryImpact(args.target!, args.workspace, args.repo));
      case "atlas_endpoints":
        return ok(queryEndpoints(args.workspace));
      case "atlas_path":
        return ok(queryPath(args.from!, args.to!, args.workspace, args.maxHops ? Number(args.maxHops) : undefined));
      case "atlas_neighborhood":
        return ok(queryNeighborhood(args.symbol!, args.workspace, args.repo, args.depth ? Number(args.depth) : undefined));
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});

export async function runMcp(): Promise<number> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stays alive on stdio until the client disconnects.
  console.error("atlas mcp server running on stdio");
  return await new Promise<number>(() => {});
}
