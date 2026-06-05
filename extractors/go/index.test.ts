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

test("scope/receiver layers resolve calls ambiguous by short name (ADR 0012)", () => {
  const out = extractGo({ repoPath: fixture, repoId: "gm" });
  const byName = (n: string) => out.nodes.find((x) => x.name === n)!;
  const hasCall = (from: string, to: string) =>
    out.edges.some((e) => e.kind === "call" && e.from === byName(from).id && e.to === byName(to).id);

  // receiver/struct-field: s.repo.save() → Repo.save, NOT the free save().
  assert.ok(hasCall("Server.handle", "Repo.save"), "expected Server.handle → Repo.save");
  assert.ok(!hasCall("Server.handle", "save"), "must not link to the free save()");

  // package scope: a bare helper() call, unique in the package, resolves.
  assert.ok(hasCall("Server.handle", "helper"), "expected Server.handle → helper");

  // negative: an ambiguous call on an un-typed receiver must emit NO edge — we
  // never guess among same-named candidates.
  const mystery = byName("Server.mystery");
  assert.ok(
    !out.edges.some((e) => e.kind === "call" && e.from === mystery.id),
    "ambiguous call on unknown receiver must not resolve",
  );
});

test("deeper receiver typing: return-type, range element, external pkg var (ADR 0015)", () => {
  const out = extractGo({ repoPath: fixture, repoId: "gm" });
  const byName = (n: string) => out.nodes.find((x) => x.name === n)!;
  const hasCall = (from: string, to: string) =>
    out.edges.some((e) => e.kind === "call" && e.from === byName(from).id && e.to === byName(to).id);

  // `r := makeRepo()` (returns *Repo) → r.save() resolves to Repo.save, not free save().
  assert.ok(hasCall("Server.more", "Repo.save"), "expected return-typed Server.more → Repo.save");
  assert.ok(!hasCall("Server.more", "save"), "must not link to the free save()");

  // `for _, o := range []Order{}` → o.Process() resolves to Order.Process (ambiguous name).
  assert.ok(hasCall("Server.more", "Order.Process"), "expected range-typed Server.more → Order.Process");
  assert.ok(!hasCall("Server.more", "Worker.Process"), "must not link to Worker.Process");

  // `conn` is a package var of a non-repo type → conn.save() is external, no edge.
  const ping = byName("Server.ping");
  assert.ok(
    !out.edges.some((e) => e.kind === "call" && e.from === ping.id),
    "call on an external-typed package var must not resolve",
  );
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
