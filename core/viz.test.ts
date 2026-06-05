import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCyModel } from "./viz.js";
import { SCHEMA_VERSION, type ExtractorOutput, type MergedMap } from "./schema.js";

function topo(repo: string, fns: [string, string][], edges: [string, string][]): ExtractorOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    repo,
    generatedAt: "t",
    nodes: fns.map(([sym, file]) => ({ id: `${repo}:${file}#${sym}`, kind: "function", name: sym, file, line: 1 })),
    edges: edges.map(([f, t]) => ({ from: f, to: t, kind: "call" as const, line: 1 })),
    endpoints: { consumes: [], exposes: [] },
  };
}

test("buildCyModel produces a repo → module → function compound hierarchy", () => {
  const t = topo(
    "web",
    [["a", "src/api/x.ts"], ["b", "src/api/x.ts"], ["c", "src/util/y.ts"]],
    [["web:src/api/x.ts#a", "web:src/util/y.ts#c"]],
  );
  const m = buildCyModel([t], undefined);

  const byId = new Map(m.nodes.map((n) => [n.data.id as string, n.data]));
  assert.ok(byId.has("repo:web"));
  // functions parent to their directory module, which parents to the repo.
  const a = byId.get("web:src/api/x.ts#a")!;
  assert.equal(a.kind, "fn");
  assert.equal(a.parent, "mod:web/src/api");
  assert.equal(byId.get("mod:web/src/api")!.parent, "repo:web");
  assert.equal(byId.get("mod:web/src/util")!.parent, "repo:web");

  assert.deepEqual(m.counts, { repos: 1, modules: 2, functions: 3, edges: 1 });
  assert.equal(m.edges[0]!.data.kind, "call");
});

test("cross-repo contracts become one weighted repo→repo summary edge", () => {
  const web = topo("web", [["a", "src/api.ts"], ["b", "src/api.ts"]], []);
  const svc = topo("svc", [["x", "h.go"], ["y", "h.go"]], []);
  const map: MergedMap = {
    schemaVersion: SCHEMA_VERSION,
    workspace: "w",
    generatedAt: "t",
    repos: ["web", "svc"],
    crossRepoEdges: [
      { from: "web:src/api.ts#a", to: "svc:h.go#x", kind: "http", contract: "GET /x" },
      { from: "web:src/api.ts#b", to: "svc:h.go#y", kind: "http", contract: "POST /y" },
    ],
    externalNodes: [],
  };
  const m = buildCyModel([web, svc], map);
  const http = m.edges.filter((e) => e.data.kind === "repohttp");
  assert.equal(http.length, 1, "two contracts aggregate into one repo→repo edge");
  assert.equal(http[0]!.data.source, "repo:web");
  assert.equal(http[0]!.data.target, "repo:svc");
  assert.equal(http[0]!.data.weight, 2);
  assert.deepEqual((http[0]!.data.contracts as string[]).sort(), ["GET /x", "POST /y"]);
});

test("--repo scopes to one repo (and omits cross-repo edges)", () => {
  const web = topo("web", [["a", "x.ts"]], []);
  const svc = topo("svc", [["h", "h.go"]], []);
  const map: MergedMap = {
    schemaVersion: SCHEMA_VERSION,
    workspace: "w",
    generatedAt: "t",
    repos: ["web", "svc"],
    crossRepoEdges: [{ from: "web:x.ts#a", to: "svc:h.go#h", kind: "http", contract: "GET /x" }],
    externalNodes: [],
  };
  const m = buildCyModel([web, svc], map, { repo: "web" });
  assert.deepEqual(m.repos, ["web"]);
  assert.ok(m.nodes.every((n) => n.data.repo === "web"));
  assert.equal(m.edges.length, 0);
});
