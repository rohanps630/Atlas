import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph.js";
import { transitiveCallers } from "./impact.js";
import type { ExtractorOutput } from "./schema.js";

// a -> b -> c (a calls b, b calls c); d calls c directly.
const output: ExtractorOutput = {
  schemaVersion: 0,
  repo: "r",
  generatedAt: "2026-06-05T00:00:00Z",
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
    { from: "r:f.ts#d", to: "r:f.ts#c", kind: "call", line: 3 },
  ],
  endpoints: { consumes: [], exposes: [] },
};

test("transitiveCallers walks reverse call edges, excludes seed", () => {
  const g = buildGraph(output);
  const names = transitiveCallers(g, ["r:f.ts#c"]).map((n) => n.name).sort();
  assert.deepEqual(names, ["a", "b", "d"]);
});

test("transitiveCallers on a root returns nothing", () => {
  const g = buildGraph(output);
  assert.deepEqual(transitiveCallers(g, ["r:f.ts#a"]), []);
});

test("transitiveCallers is cycle-safe", () => {
  const cyclic = buildGraph({
    ...output,
    edges: [
      { from: "r:f.ts#a", to: "r:f.ts#b", kind: "call", line: 1 },
      { from: "r:f.ts#b", to: "r:f.ts#a", kind: "call", line: 2 },
    ],
  });
  assert.deepEqual(transitiveCallers(cyclic, ["r:f.ts#a"]).map((n) => n.name), ["b"]);
});
