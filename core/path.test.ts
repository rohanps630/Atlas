import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "./graph.js";
import { shortestPath } from "./path.js";
import type { AtlasEdge, AtlasNode } from "./schema.js";

const nodes: AtlasNode[] = [
  { id: "web:o.ts#createOrder", kind: "function", name: "createOrder", file: "o.ts", line: 1 },
  { id: "web:o.ts#helper", kind: "function", name: "helper", file: "o.ts", line: 5 },
  { id: "svc:h.go#Create", kind: "function", name: "Create", file: "h.go", line: 9 },
  { id: "svc:h.go#save", kind: "function", name: "save", file: "h.go", line: 20 },
];
const edges: AtlasEdge[] = [
  { from: "web:o.ts#createOrder", to: "web:o.ts#helper", kind: "call", line: 2 },
  { from: "web:o.ts#createOrder", to: "svc:h.go#Create", kind: "http", line: 0 },
  { from: "svc:h.go#Create", to: "svc:h.go#save", kind: "call", line: 10 },
];

test("path spans a cross-repo http hop and a call hop", () => {
  const g = new Graph(nodes, edges);
  const res = shortestPath(g, ["web:o.ts#createOrder"], ["svc:h.go#save"]);
  assert.ok(res);
  assert.deepEqual(res!.hops.map((h) => h.node.name), ["createOrder", "Create", "save"]);
  assert.equal(res!.hops[1]!.via!.kind, "http");
  assert.equal(res!.hops[2]!.via!.kind, "call");
});

test("returns null when disconnected", () => {
  const g = new Graph(nodes, [{ from: "web:o.ts#createOrder", to: "web:o.ts#helper", kind: "call", line: 2 }]);
  assert.equal(shortestPath(g, ["web:o.ts#createOrder"], ["svc:h.go#save"]), null);
});

test("same start and goal is a single hop", () => {
  const g = new Graph(nodes, edges);
  const res = shortestPath(g, ["svc:h.go#save"], ["svc:h.go#save"]);
  assert.deepEqual(res!.hops.map((h) => h.node.name), ["save"]);
});
