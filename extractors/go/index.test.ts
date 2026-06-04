import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractGo } from "./index.js";

// Light test (ADR 0005): confirm Go functions/methods, a resolved call, and chi
// exposes with nested-Route + const base-path resolution.
const fixture = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/go-mini");

test("extracts go functions and a resolved call edge", () => {
  const out = extractGo({ repoPath: fixture, repoId: "gm" });
  const names = out.nodes.filter((n) => n.kind === "function").map((n) => n.name);
  assert.ok(names.includes("ListOrders"));
  assert.ok(names.includes("save"));

  const lo = out.nodes.find((n) => n.name === "ListOrders")!;
  const save = out.nodes.find((n) => n.name === "save")!;
  assert.ok(out.edges.some((e) => e.kind === "call" && e.from === lo.id && e.to === save.id));
});

test("chi exposes resolve nested Route + const BasePath into full paths", () => {
  const out = extractGo({ repoPath: fixture, repoId: "gm" });
  const paths = out.endpoints.exposes.map((e) => `${e.method} ${e.path}`);
  // BasePath = "/api/" + "v1" = "/api/v1"; nested under /orders
  assert.ok(paths.includes("GET /api/v1/orders/"), `got ${paths.join(", ")}`);
  assert.ok(paths.includes("GET /api/v1/orders/{id}"), `got ${paths.join(", ")}`);

  // handler resolves to the in-repo function node
  const listing = out.endpoints.exposes.find((e) => e.path === "/api/v1/orders/")!;
  assert.ok(listing.handler.endsWith("#ListOrders"), `handler=${listing.handler}`);
});
