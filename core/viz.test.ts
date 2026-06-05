import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVizModel } from "./viz.js";
import { SCHEMA_VERSION, type ExtractorOutput, type MergedMap } from "./schema.js";

function topo(repo: string, nodes: [string, string][], edges: [string, string][]): ExtractorOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    repo,
    generatedAt: "t",
    nodes: nodes.map(([sym, file]) => ({ id: `${repo}:${file}#${sym}`, kind: "function", name: sym, file, line: 1 })),
    edges: edges.map(([f, t]) => ({ from: `${repo}:x#${f}`, to: `${repo}:x#${t}`, kind: "call" as const, line: 1 })),
    endpoints: { consumes: [], exposes: [] },
  };
}

test("buildVizModel drops isolated nodes, tags repos, lays out connected ones", () => {
  const t = topo("web", [["a", "x"], ["b", "x"], ["lonely", "x"]], [["a", "b"]]);
  const model = buildVizModel([t], undefined);

  const labels = model.nodes.map((n) => n.label).sort();
  assert.deepEqual(labels, ["a", "b"], "isolated node 'lonely' is dropped");
  assert.deepEqual(model.repos, ["web"]);
  assert.ok(model.nodes.every((n) => n.repo === "web"));
  assert.equal(model.edges.length, 1);
  // every node has a finite laid-out position
  assert.ok(model.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test("cross-repo http edges are included", () => {
  const web = topo("web", [["call", "api"]], []);
  const svc = topo("svc", [["handle", "h"]], []);
  const map: MergedMap = {
    schemaVersion: SCHEMA_VERSION,
    workspace: "w",
    generatedAt: "t",
    repos: ["web", "svc"],
    crossRepoEdges: [{ from: "web:api#call", to: "svc:h#handle", kind: "http", contract: "GET /x" }],
    externalNodes: [],
  };
  const model = buildVizModel([web, svc], map);
  assert.equal(model.nodes.length, 2, "both endpoints of the http edge are kept");
  assert.deepEqual(model.repos, ["svc", "web"]);
  assert.ok(model.edges.some((e) => e.kind === "http"));
});

test("layout is deterministic for the same model", () => {
  const t = topo("r", [["a", "x"], ["b", "x"], ["c", "x"]], [["a", "b"], ["b", "c"]]);
  const m1 = buildVizModel([t], undefined);
  const m2 = buildVizModel([t], undefined);
  assert.deepEqual(
    m1.nodes.map((n) => [n.id, n.x, n.y]),
    m2.nodes.map((n) => [n.id, n.x, n.y]),
  );
});
