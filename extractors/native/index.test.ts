import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractNative } from "./index.js";

// Light test (extractors churn — ADR 0005): confirm tree-sitter parses Swift and
// Kotlin into the normalized shape and resolves an obvious same-class call.
const fixture = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/native-mini");

for (const language of ["swift", "kotlin"] as const) {
  test(`extracts ${language} functions and a resolved call edge`, () => {
    const out = extractNative({ repoPath: fixture, repoId: "nm", language });

    const names = out.nodes.filter((n) => n.kind === "function").map((n) => n.name);
    assert.ok(names.includes("Greeter.greet"), `expected Greeter.greet, got ${names}`);
    assert.ok(names.includes("Greeter.build"), `expected Greeter.build, got ${names}`);

    // `build` is ambiguous repo-wide (Greeter.build + Other.build). The bare
    // call build() inside Greeter resolves to Greeter.build via the class-scope
    // layer (ADR 0012) — the pre-0012 resolver would have skipped it.
    const greet = out.nodes.find((n) => n.name === "Greeter.greet")!;
    const build = out.nodes.find((n) => n.name === "Greeter.build")!;
    const otherBuild = out.nodes.find((n) => n.name === "Other.build")!;
    const hasCall = (to: string) =>
      out.edges.some((e) => e.kind === "call" && e.from === greet.id && e.to === to);
    assert.ok(hasCall(build.id), "expected Greeter.greet → Greeter.build (scope)");

    // `val o = Other(); o.build()` resolves to Other.build via the receiver layer.
    assert.ok(hasCall(otherBuild.id), "expected Greeter.greet → Other.build (receiver)");
  });
}

test("kotlin Retrofit consumes resolve const route templates", () => {
  const out = extractNative({ repoPath: fixture, repoId: "nm", language: "kotlin" });
  const c = out.endpoints.consumes.find((e) => e.path === "/api/v1/auth/register");
  assert.ok(c, `expected POST /api/v1/auth/register, got ${out.endpoints.consumes.map((x) => x.method + " " + x.path).join(", ")}`);
  assert.equal(c!.method, "POST");
  assert.ok(c!.from.endsWith("#AuthApi.register") || c!.from.endsWith("#register"));
});
