/**
 * Atlas schema types — the keystone data contract (schemaVersion 0).
 *
 * These mirror docs/schema.md EXACTLY. Treat this file like a public API:
 * to change a shape, bump SCHEMA_VERSION, update docs/schema.md, and add a
 * CHANGELOG.md entry (see AGENTS.md rule 3). Both the extractor and the core
 * import these — the extractor produces ExtractorOutput, the core consumes it.
 *
 * Phase 1 uses only a subset: `function` nodes and `import`/`call` edges.
 * The endpoint and cross-repo shapes are part of the v0 contract but are not
 * populated until Phase 2 — they are typed here so the contract is complete.
 */

export const SCHEMA_VERSION = 0;

/** docs/schema.md §2 — Node `kind`. */
export type NodeKind =
  | "function"
  | "class"
  | "module"
  | "service"
  | "endpoint"
  | "external";

/** docs/schema.md §2 — Edge `kind`. */
export type EdgeKind = "call" | "import" | "inherit" | "expose" | "consume";

/**
 * A node in a repo's graph.
 * `id` format: `<repoId>:<relativeFile>#<symbol>` — globally unique in a workspace.
 */
export interface AtlasNode {
  id: string;
  kind: NodeKind;
  name: string;
  file: string;
  line: number;
}

/** A directed edge between two node ids. */
export interface AtlasEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  line: number;
}

/** HTTP endpoint a repo consumes (FE client call). Phase 2. */
export interface ConsumedEndpoint {
  method: string;
  path: string;
  from: string;
  line: number;
}

/** HTTP endpoint a repo exposes (BE route handler). Phase 2. */
export interface ExposedEndpoint {
  method: string;
  path: string;
  handler: string;
  line: number;
}

export interface Endpoints {
  consumes: ConsumedEndpoint[];
  exposes: ExposedEndpoint[];
}

/**
 * docs/schema.md §2 — Extractor output, one per repo (the normalized form).
 * Every language extractor emits exactly this shape; the core never sees source.
 */
export interface ExtractorOutput {
  schemaVersion: number;
  repo: string;
  generatedAt: string;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  endpoints: Endpoints;
}
