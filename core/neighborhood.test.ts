import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph.js";
import { neighborhood } from "./neighborhood.js";
import type { ExtractorOutput } from "./schema.js";

// a → b → c → d  (chain of calls)
const output: ExtractorOutput = {
  schemaVersion: 0,
  repo: "r",
  generatedAt: "t",
  nodes: ["a", "b", "c", "d"].map((n) => ({
    id: `r:f.ts#${n}`,
    kind: "function" as const,
    name: n,
    file: "f.ts",
    line: 1,
  })),
  edges: [
    { from: "r:f.ts#a", to: "r:f.ts#b", kind: "call", line: 1 },
    { from: "r:f.ts#b", to: "r:f.ts#c", kind: "call", line: 2 },
    { from: "r:f.ts#c", to: "r:f.ts#d", kind: "call", line: 3 },
  ],
  endpoints: { consumes: [], exposes: [] },
};

test("depth 1 returns immediate callers + callees", () => {
  const g = buildGraph(output);
  const nb = neighborhood(g, ["r:f.ts#b"], { depth: 1 });
  assert.deepEqual(nb.nodes.map((n) => n.name).sort(), ["a", "b", "c"]);
});

test("depth 2 reaches further and includes interior edges", () => {
  const g = buildGraph(output);
  const nb = neighborhood(g, ["r:f.ts#b"], { depth: 2 });
  assert.deepEqual(nb.nodes.map((n) => n.name).sort(), ["a", "b", "c", "d"]);
  assert.ok(nb.edges.some((e) => e.from === "r:f.ts#b" && e.to === "r:f.ts#c"));
});

test("limit truncates and reports the dropped count", () => {
  const g = buildGraph(output);
  const nb = neighborhood(g, ["r:f.ts#b"], { depth: 2, limit: 2 });
  assert.equal(nb.nodes.length, 2);
  assert.equal(nb.truncated, 2);
});
