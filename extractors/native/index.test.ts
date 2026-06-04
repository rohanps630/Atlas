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

    // greet() calls build() — resolved by unique short name within the repo.
    const greet = out.nodes.find((n) => n.name === "Greeter.greet")!;
    const build = out.nodes.find((n) => n.name === "Greeter.build")!;
    const linked = out.edges.some(
      (e) => e.kind === "call" && e.from === greet.id && e.to === build.id,
    );
    assert.ok(linked, "expected Greeter.greet → Greeter.build call edge");
  });
}
