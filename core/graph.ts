/**
 * Intra-repo graph — the language-agnostic core (ADR 0005).
 *
 * Consumes ONLY normalized ExtractorOutput (docs/schema.md §2) — never source
 * code. Pure and I/O-free so it is cheap to test hard. Phase 1 answers the
 * intra-repo questions a context pack needs: callers and callees of a symbol.
 */

import type { AtlasEdge, AtlasNode, ExtractorOutput } from "./schema.js";

export class Graph {
  /** All nodes, keyed by node id. */
  readonly nodes: Map<string, AtlasNode>;
  /** All edges, in extractor order. */
  readonly edges: AtlasEdge[];

  /** node id -> outgoing call edges (this calls X). */
  private readonly outgoingCalls: Map<string, AtlasEdge[]>;
  /** node id -> incoming call edges (X is called by this). */
  private readonly incomingCalls: Map<string, AtlasEdge[]>;
  /** symbol name -> node ids that share it (names are not unique). */
  private readonly byName: Map<string, string[]>;
  /** relative file path -> node ids declared in it. */
  private readonly byFile: Map<string, string[]>;

  constructor(nodes: Iterable<AtlasNode>, edges: Iterable<AtlasEdge>) {
    this.nodes = new Map();
    this.edges = [];
    this.outgoingCalls = new Map();
    this.incomingCalls = new Map();
    this.byName = new Map();
    this.byFile = new Map();

    for (const node of nodes) {
      this.nodes.set(node.id, node);
      // Module nodes are addressed by file/id, never by symbol name — keeping
      // them out of the name index stops a file path from matching as a symbol.
      if (node.kind !== "module") push(this.byName, node.name, node.id);
      push(this.byFile, node.file, node.id);
    }

    for (const edge of edges) {
      this.edges.push(edge);
      if (edge.kind === "call") {
        push(this.outgoingCalls, edge.from, edge);
        push(this.incomingCalls, edge.to, edge);
      }
    }
  }

  /** Look up a node by its exact id. */
  node(id: string): AtlasNode | undefined {
    return this.nodes.get(id);
  }

  /** Nodes that call `id` (reverse call edges). Only resolved nodes are returned. */
  callersOf(id: string): AtlasNode[] {
    return this.resolve(this.incomingCalls.get(id), (e) => e.from);
  }

  /** Nodes that `id` calls (forward call edges). Only resolved nodes are returned. */
  calleesOf(id: string): AtlasNode[] {
    return this.resolve(this.outgoingCalls.get(id), (e) => e.to);
  }

  /** Find nodes whose symbol name matches exactly. */
  findBySymbol(name: string): AtlasNode[] {
    return (this.byName.get(name) ?? []).map((id) => this.nodes.get(id)!);
  }

  /**
   * Find nodes declared in a file. Matches an exact relative path, or any file
   * that ends with the given suffix (so `orders/api.ts` matches a longer path).
   */
  findByFile(file: string): AtlasNode[] {
    const exact = this.byFile.get(file);
    if (exact) return exact.map((id) => this.nodes.get(id)!);

    const ids: string[] = [];
    for (const [path, nodeIds] of this.byFile) {
      if (path === file || path.endsWith(`/${file}`)) ids.push(...nodeIds);
    }
    return ids.map((id) => this.nodes.get(id)!);
  }

  private resolve(
    edges: AtlasEdge[] | undefined,
    pick: (e: AtlasEdge) => string,
  ): AtlasNode[] {
    if (!edges) return [];
    const seen = new Set<string>();
    const out: AtlasNode[] = [];
    for (const edge of edges) {
      const id = pick(edge);
      if (seen.has(id)) continue;
      seen.add(id);
      const node = this.nodes.get(id);
      if (node) out.push(node); // unresolved targets (e.g. external) are skipped in Phase 1
    }
    return out;
  }
}

/** Build a Graph from one extractor output. */
export function buildGraph(output: ExtractorOutput): Graph {
  return new Graph(output.nodes, output.edges);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
