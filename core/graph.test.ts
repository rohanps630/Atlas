import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph.js";
import type { ExtractorOutput } from "./schema.js";

function fixture(): ExtractorOutput {
  return {
    schemaVersion: 0,
    repo: "r",
    generatedAt: "2026-06-04T00:00:00Z",
    nodes: [
      { id: "r:a.ts#a", kind: "function", name: "a", file: "a.ts", line: 1 },
      { id: "r:a.ts#b", kind: "function", name: "b", file: "a.ts", line: 5 },
      { id: "r:b.ts#c", kind: "function", name: "c", file: "b.ts", line: 1 },
      { id: "r:b.ts", kind: "module", name: "b.ts", file: "b.ts", line: 1 },
    ],
    edges: [
      { from: "r:a.ts#a", to: "r:a.ts#b", kind: "call", line: 2 },
      { from: "r:a.ts#a", to: "r:b.ts#c", kind: "call", line: 3 },
      { from: "r:a.ts#b", to: "r:b.ts#c", kind: "call", line: 6 },
      { from: "r:a.ts#a", to: "r:missing#x", kind: "call", line: 4 },
    ],
  };
}

test("calleesOf returns resolved called nodes, skips unresolved", () => {
  const g = buildGraph(fixture());
  const callees = g.calleesOf("r:a.ts#a").map((n) => n.id);
  assert.deepEqual(callees.sort(), ["r:a.ts#b", "r:b.ts#c"]);
});

test("callersOf returns reverse call edges", () => {
  const g = buildGraph(fixture());
  const callers = g.callersOf("r:b.ts#c").map((n) => n.id);
  assert.deepEqual(callers.sort(), ["r:a.ts#a", "r:a.ts#b"]);
});

test("leaf node has no callees", () => {
  const g = buildGraph(fixture());
  assert.deepEqual(g.calleesOf("r:b.ts#c"), []);
});

test("findBySymbol matches by exact name", () => {
  const g = buildGraph(fixture());
  assert.deepEqual(
    g.findBySymbol("c").map((n) => n.id),
    ["r:b.ts#c"],
  );
  assert.deepEqual(g.findBySymbol("nope"), []);
});

test("findByFile matches exact path and suffix", () => {
  const g = buildGraph(fixture());
  assert.equal(g.findByFile("a.ts").length, 2);
  // suffix match against a longer stored path
  const g2 = buildGraph({
    ...fixture(),
    nodes: [
      { id: "r:src/a.ts#a", kind: "function", name: "a", file: "src/a.ts", line: 1 },
    ],
    edges: [],
  });
  assert.equal(g2.findByFile("a.ts").length, 1);
});

test("call edges only counted; import/other edges ignored for callers/callees", () => {
  const g = buildGraph({
    ...fixture(),
    edges: [{ from: "r:a.ts", to: "r:b.ts", kind: "import", line: 1 }],
  });
  assert.deepEqual(g.calleesOf("r:a.ts"), []);
});
