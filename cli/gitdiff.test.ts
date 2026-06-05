import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, changedFunctionIds } from "./gitdiff.js";
import { SCHEMA_VERSION, type ExtractorOutput } from "../core/schema.js";

// Pure mapper tests (no git): unified-0 diff parsing + line→function mapping (ADR 0017).

test("parseDiff extracts new-side changed line numbers per file", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -10,0 +11,2 @@", // 2 added lines at 11,12
    "+x",
    "+y",
    "@@ -20,1 +22,1 @@", // 1 changed line at 22
    "-old",
    "+new",
    "--- a/src/gone.ts",
    "+++ b/src/gone.ts",
    "@@ -5,2 +5,0 @@", // pure deletion → no new-side lines
    "-a",
    "-b",
  ].join("\n");

  const m = parseDiff(diff);
  assert.deepEqual([...(m.get("src/a.ts") ?? [])].sort((x, y) => x - y), [11, 12, 22]);
  assert.equal(m.has("src/gone.ts"), false, "pure deletion contributes no changed lines");
});

test("changedFunctionIds maps a changed line to its owning function", () => {
  const topo: ExtractorOutput = {
    schemaVersion: SCHEMA_VERSION,
    repo: "r",
    generatedAt: "t",
    nodes: [
      { id: "r:a.ts#first", kind: "function", name: "first", file: "a.ts", line: 1 },
      { id: "r:a.ts#second", kind: "function", name: "second", file: "a.ts", line: 20 },
      { id: "r:a.ts#third", kind: "function", name: "third", file: "a.ts", line: 40 },
    ],
    edges: [],
    endpoints: { consumes: [], exposes: [] },
  };

  // line 25 falls in second's span [20,40); line 45 in third's [40,∞).
  const changed = new Map([["a.ts", new Set([25, 45])]]);
  const ids = changedFunctionIds(topo, changed).sort();
  assert.deepEqual(ids, ["r:a.ts#second", "r:a.ts#third"]);

  // a change before the first function maps to nothing (no owning function).
  assert.deepEqual(changedFunctionIds(topo, new Map([["a.ts", new Set([0])]])), []);
  // a change in an unknown file maps to nothing.
  assert.deepEqual(changedFunctionIds(topo, new Map([["other.ts", new Set([5])]])), []);
});
