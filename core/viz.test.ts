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

const MAP: MergedMap = {
  schemaVersion: SCHEMA_VERSION,
  workspace: "w",
  generatedAt: "t",
  repos: ["web", "svc"],
  crossRepoEdges: [
    { from: "web:api#a", to: "svc:h#x", kind: "http", contract: "GET /x" },
    { from: "web:api#b", to: "svc:h#y", kind: "http", contract: "POST /y" },
  ],
  externalNodes: [{ id: "external:POST /pay", reason: "no repo exposes it", consumedBy: ["web:api#c"] }],
};

test("system level: one node per repo + externals, aggregated contract edges", () => {
  const web = topo("web", [["a", "x"]], []);
  const svc = topo("svc", [["x", "h"]], []);
  const m = buildVizModel([web, svc], MAP); // default level = system

  assert.equal(m.level, "system");
  assert.deepEqual(m.nodes.filter((n) => n.kind === "repo").map((n) => n.id).sort(), ["svc", "web"]);
  assert.ok(m.nodes.some((n) => n.kind === "external" && n.label === "POST /pay"));

  // the two web→svc contracts aggregate into one weighted edge.
  const webToSvc = m.edges.find((e) => e.from === "web" && e.to === "svc");
  assert.ok(webToSvc, "expected an aggregated web→svc edge");
  assert.equal(webToSvc!.weight, 2);
  assert.deepEqual(webToSvc!.contracts!.sort(), ["GET /x", "POST /y"]);
  // and a web→external edge.
  assert.ok(m.edges.some((e) => e.from === "web" && e.to === "external:POST /pay"));
});

test("calls level: connected function nodes, isolated dropped, deterministic", () => {
  const t = topo("r", [["a", "x"], ["b", "x"], ["lonely", "x"]], [["a", "b"]]);
  const m = buildVizModel([t], undefined, { level: "calls" });
  assert.equal(m.level, "calls");
  assert.deepEqual(m.nodes.map((n) => n.label).sort(), ["a", "b"]); // 'lonely' dropped

  const again = buildVizModel([t], undefined, { level: "calls" });
  assert.deepEqual(
    m.nodes.map((n) => [n.id, n.x, n.y]),
    again.nodes.map((n) => [n.id, n.x, n.y]),
  );
});

test("--repo implies the calls level for one repo", () => {
  const web = topo("web", [["a", "x"], ["b", "x"]], [["a", "b"]]);
  const svc = topo("svc", [["x", "h"], ["y", "h"]], [["x", "y"]]);
  const m = buildVizModel([web, svc], undefined, { repo: "web" });
  assert.equal(m.level, "calls");
  assert.ok(m.nodes.every((n) => n.repo === "web"), "scoped to web only");
});
