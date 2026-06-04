import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph.js";
import { contextPack, resolveTargets } from "./context.js";
import type { ExtractorOutput } from "./schema.js";

const output: ExtractorOutput = {
  schemaVersion: 0,
  repo: "r",
  generatedAt: "2026-06-04T00:00:00Z",
  nodes: [
    { id: "r:orders.ts", kind: "module", name: "orders.ts", file: "orders.ts", line: 1 },
    { id: "r:orders.ts#createOrder", kind: "function", name: "createOrder", file: "orders.ts", line: 3 },
    { id: "r:http.ts#post", kind: "function", name: "post", file: "http.ts", line: 1 },
    { id: "r:app.ts#main", kind: "function", name: "main", file: "app.ts", line: 1 },
  ],
  edges: [
    { from: "r:app.ts#main", to: "r:orders.ts#createOrder", kind: "call", line: 2 },
    { from: "r:orders.ts#createOrder", to: "r:http.ts#post", kind: "call", line: 4 },
  ],
};

test("resolveTargets prefers id, then symbol, then file", () => {
  const g = buildGraph(output);
  assert.equal(resolveTargets(g, "r:http.ts#post").resolvedAs, "id");
  assert.equal(resolveTargets(g, "createOrder").resolvedAs, "symbol");
  assert.equal(resolveTargets(g, "orders.ts").resolvedAs, "file");
  assert.equal(resolveTargets(g, "ghost").resolvedAs, "unresolved");
});

test("contextPack gathers callers and callees for a symbol", () => {
  const g = buildGraph(output);
  const pack = contextPack(g, "createOrder");
  assert.equal(pack.targets.length, 1);
  const t = pack.targets[0]!;
  assert.deepEqual(t.callers.map((n) => n.name), ["main"]);
  assert.deepEqual(t.callees.map((n) => n.name), ["post"]);
});

test("file query returns the file's functions, not the module node", () => {
  const g = buildGraph(output);
  const { nodes, resolvedAs } = resolveTargets(g, "orders.ts");
  assert.equal(resolvedAs, "file");
  assert.deepEqual(nodes.map((n) => n.name), ["createOrder"]);
});

test("contextPack on unresolved query yields no targets", () => {
  const g = buildGraph(output);
  const pack = contextPack(g, "ghost");
  assert.equal(pack.resolvedAs, "unresolved");
  assert.deepEqual(pack.targets, []);
});
