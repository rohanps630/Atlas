import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractRepo } from "./index.js";
import { linkRepos } from "../../core/link.js";

// Light test (extractors churn — ADR 0005): just confirm the extractor produces
// the normalized shape and resolves an obvious in-repo call against the fixture.
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const fixtureRepo = join(fixturesDir, "ts-mini");

test("extracts functions, import edges, and resolved call edges", () => {
  const out = extractRepo({ repoPath: fixtureRepo, repoId: "ts-mini" });

  assert.equal(out.schemaVersion, 0);
  assert.equal(out.repo, "ts-mini");

  const names = out.nodes.filter((n) => n.kind === "function").map((n) => n.name);
  assert.ok(names.includes("createOrder"));
  assert.ok(names.includes("getOrder")); // arrow function assigned to a const
  assert.ok(names.includes("post"));

  // createOrder -> post is a call that resolves within the repo.
  const createOrder = out.nodes.find((n) => n.name === "createOrder")!;
  const post = out.nodes.find((n) => n.name === "post")!;
  const hasCall = out.edges.some(
    (e) => e.kind === "call" && e.from === createOrder.id && e.to === post.id,
  );
  assert.ok(hasCall, "expected createOrder -> post call edge");

  // orders.ts imports http.ts → a module-level import edge exists.
  const hasImport = out.edges.some(
    (e) => e.kind === "import" && e.from.endsWith("orders.ts") && e.to.endsWith("http.ts"),
  );
  assert.ok(hasImport, "expected orders.ts -> http.ts import edge");
});

test("extracts route and symbolic consumed endpoints", () => {
  const out = extractRepo({ repoPath: fixtureRepo, repoId: "ts-mini" });
  const consumes = out.endpoints.consumes;

  // api.post("/api/users", ...) → POST /api/users (a real route)
  const createUser = consumes.find((c) => c.method === "POST" && c.path === "/api/users");
  assert.ok(createUser, "expected POST /api/users");

  // api.get(`/api/users/${id}`) → GET with a template route
  const getUser = consumes.find((c) => c.method === "GET" && c.path.includes("/api/users/"));
  assert.ok(getUser, "expected GET /api/users/...");

  // api.get(resolveSlug("user","me")) → symbolic path recorded verbatim
  const symbolic = consumes.find((c) => c.path.includes("resolveSlug"));
  assert.ok(symbolic, "expected a symbolic consume");

  // The bare-identifier `fetch(url)` inside api.ts must be filtered out.
  assert.ok(!consumes.some((c) => c.path === "url"), "bare-identifier path should be dropped");
});

test("FE consumes links to BE exposes across the cross fixture", () => {
  const web = extractRepo({ repoPath: join(fixturesDir, "cross/web"), repoId: "web" });
  const svc = extractRepo({ repoPath: join(fixturesDir, "cross/svc"), repoId: "svc" });

  // BE exposes POST /api/orders, handler resolved to the named function.
  const expose = svc.endpoints.exposes.find((e) => e.path === "/api/orders");
  assert.equal(expose?.method, "POST");
  assert.ok(expose?.handler.endsWith("handlers.ts#createOrderHandler"));

  // Linking the two repos resolves the consume↔expose into a cross-repo edge.
  const map = linkRepos([web, svc], { workspace: "x", generatedAt: "t" });
  assert.equal(map.externalNodes.length, 0);
  assert.equal(map.crossRepoEdges.length, 1);
  const edge = map.crossRepoEdges[0]!;
  assert.equal(edge.contract, "POST /api/orders");
  assert.ok(edge.from.endsWith("orders.ts#createOrder"));
  assert.ok(edge.to.endsWith("handlers.ts#createOrderHandler"));
});
