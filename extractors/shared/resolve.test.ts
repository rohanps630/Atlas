import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addResolution,
  coverage,
  coveragePct,
  newStats,
  resolveCall,
  toCallResolution,
} from "./resolve.js";

// The layered-resolution policy (ADR 0012) and the coverage projection (ADR 0013)
// are the load-bearing shared logic — test them directly.

test("resolveCall prefers the earliest layer with an opinion", () => {
  const s = newStats();
  const r = resolveCall(
    "caller",
    [
      { via: "receiver", candidates: ["A"] },
      { via: "global", candidates: ["A", "B"] }, // never reached
    ],
    s,
  );
  assert.deepEqual(r, { to: "A", via: "receiver" });
  assert.equal(s.resolved, 1);
  assert.equal(s.viaReceiver, 1);
});

test("resolveCall falls through empty layers, then resolves", () => {
  const s = newStats();
  const r = resolveCall(
    "caller",
    [
      { via: "receiver", candidates: [] },
      { via: "scope", candidates: ["X"] },
    ],
    s,
  );
  assert.deepEqual(r, { to: "X", via: "scope" });
  assert.equal(s.viaScope, 1);
});

test("resolveCall refuses to guess among >1 candidates at the deciding layer", () => {
  const s = newStats();
  const r = resolveCall("caller", [{ via: "scope", candidates: ["A", "B"] }], s);
  assert.equal(r, undefined);
  assert.equal(s.skippedAmbiguous, 1);
});

test("resolveCall emits no self-edge, and counts unresolved", () => {
  const s = newStats();
  assert.equal(resolveCall("self", [{ via: "global", candidates: ["self"] }], s), undefined);
  assert.equal(s.skippedSelf, 1);
  assert.equal(resolveCall("c", [{ via: "global", candidates: [] }], s), undefined);
  assert.equal(s.unresolved, 1);
});

test("coverage excludes external calls and rounds to a percent", () => {
  const r = { resolved: 8, internalUnresolved: 2, external: 100, total: 110 };
  assert.equal(coverage(r), 0.8);
  assert.equal(coveragePct(r), "80%");
});

test("coverage is undefined (n/a) when there are no in-repo calls", () => {
  const r = { resolved: 0, internalUnresolved: 0, external: 5, total: 5 };
  assert.equal(coverage(r), undefined);
  assert.equal(coveragePct(r), "n/a");
});

test("toCallResolution maps the stat buckets; addResolution sums", () => {
  const cr = toCallResolution({
    total: 10,
    resolved: 5,
    viaReceiver: 1,
    viaScope: 2,
    viaGlobal: 2,
    skippedAmbiguous: 3,
    skippedSelf: 0,
    unresolved: 2,
  });
  assert.deepEqual(cr, { resolved: 5, internalUnresolved: 3, external: 2, total: 10 });
  assert.equal(addResolution(cr, cr).resolved, 10);
});
