import { test } from "node:test";
import assert from "node:assert/strict";
import { contractOf, linkRepos, normalizePath } from "./link.js";
import type { ExtractorOutput } from "./schema.js";

function repo(name: string, endpoints: ExtractorOutput["endpoints"]): ExtractorOutput {
  return {
    schemaVersion: 0,
    repo: name,
    generatedAt: "2026-06-05T00:00:00Z",
    nodes: [],
    edges: [],
    endpoints,
  };
}

const opts = { workspace: "ws", generatedAt: "2026-06-05T00:00:00Z" };

test("normalizePath strips param names (express, brace, template)", () => {
  assert.equal(normalizePath("/api/orders/:id"), "/api/orders/{}");
  assert.equal(normalizePath("/api/orders/{id}"), "/api/orders/{}");
  assert.equal(normalizePath("/api/orders/${id}"), "/api/orders/{}");
});

test("matching consume and expose resolve to a cross-repo edge", () => {
  const fe = repo("fe", {
    consumes: [
      { method: "POST", path: "/api/orders", from: "fe:a#create", line: 1 },
    ],
    exposes: [],
  });
  const be = repo("be", {
    consumes: [],
    exposes: [
      { method: "POST", path: "/api/orders", handler: "be:h#createHandler", line: 9 },
    ],
  });
  const map = linkRepos([fe, be], opts);
  assert.equal(map.crossRepoEdges.length, 1);
  assert.equal(map.externalNodes.length, 0);
  assert.deepEqual(map.crossRepoEdges[0], {
    from: "fe:a#create",
    to: "be:h#createHandler",
    kind: "http",
    contract: "POST /api/orders",
  });
});

test("param paths link across :id <-> {id} differences", () => {
  const fe = repo("fe", {
    consumes: [{ method: "GET", path: "/api/orders/:id", from: "fe:a#get", line: 1 }],
    exposes: [],
  });
  const be = repo("be", {
    consumes: [],
    exposes: [{ method: "GET", path: "/api/orders/{id}", handler: "be:h#get", line: 2 }],
  });
  const map = linkRepos([fe, be], opts);
  assert.equal(map.crossRepoEdges.length, 1);
  assert.equal(map.crossRepoEdges[0]!.contract, contractOf("GET", "/api/orders/:id"));
});

test("unmatched consume becomes an external node, not an error", () => {
  const fe = repo("fe", {
    consumes: [
      { method: "POST", path: "/api/payments", from: "fe:b#pay", line: 3 },
      { method: "POST", path: "/api/payments", from: "fe:c#pay2", line: 4 },
    ],
    exposes: [],
  });
  const map = linkRepos([fe], opts);
  assert.equal(map.crossRepoEdges.length, 0);
  assert.equal(map.externalNodes.length, 1);
  const n = map.externalNodes[0]!;
  assert.equal(n.id, "external:POST /api/payments");
  assert.deepEqual(n.consumedBy, ["fe:b#pay", "fe:c#pay2"]);
});

test("symbolic (unresolved) consume never matches and stays external", () => {
  const fe = repo("fe", {
    consumes: [
      { method: "GET", path: 'resolveSlug("user","me")', from: "fe:s#me", line: 5 },
    ],
    exposes: [{ method: "GET", path: "/user/me", handler: "be:h#me", line: 1 }],
  });
  const map = linkRepos([fe], opts);
  assert.equal(map.crossRepoEdges.length, 0);
  assert.equal(map.externalNodes.length, 1);
  assert.equal(map.externalNodes[0]!.id, 'external:GET resolveSlug("user","me")');
});
