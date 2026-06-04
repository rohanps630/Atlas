import { test } from "node:test";
import assert from "node:assert/strict";
import { inferStack, type Evidence } from "./detect.js";

function ev(partial: Partial<Evidence>): Evidence {
  return {
    deps: {},
    rootFiles: new Set(),
    exts: new Set(),
    isPackage: false,
    monorepo: false,
    goModules: [],
    ...partial,
  };
}

test("Expo RN app with native modules → fe, multi-language", () => {
  const d = inferStack(
    ev({
      deps: { expo: "54", "react-native": "0.81", react: "19" },
      rootFiles: new Set(["package.json", "app.config.ts", "tsconfig.json"]),
      exts: new Set([".ts", ".tsx", ".swift", ".kt"]),
    }),
  );
  assert.equal(d.role, "fe");
  assert.deepEqual(d.languages, ["typescript", "swift", "kotlin"]);
  assert.ok(d.frameworks.includes("Expo"));
  assert.ok(d.frameworks.includes("React Native"));
});

test("Express service → be", () => {
  const d = inferStack(
    ev({ deps: { express: "4" }, rootFiles: new Set(["package.json"]), exts: new Set([".ts"]) }),
  );
  assert.equal(d.role, "be");
  assert.ok(d.frameworks.includes("Express"));
});

test("Next.js by config file with no dep still detects fe", () => {
  const d = inferStack(ev({ rootFiles: new Set(["next.config.js"]), exts: new Set([".tsx"]) }));
  assert.equal(d.role, "fe");
  assert.ok(d.frameworks.includes("Next.js"));
});

test("library package → lib", () => {
  const d = inferStack(
    ev({ deps: { lodash: "4" }, rootFiles: new Set(["package.json"]), exts: new Set([".ts"]), isPackage: true }),
  );
  assert.equal(d.role, "lib");
});

test("plain scripts dir → tool", () => {
  const d = inferStack(ev({ exts: new Set([".js"]) }));
  assert.equal(d.role, "tool");
});

test("Go chi backend → be with go language", () => {
  const d = inferStack(
    ev({ rootFiles: new Set(["go.mod"]), exts: new Set([".go"]), goModules: ["github.com/go-chi/chi/v5"] }),
  );
  assert.equal(d.role, "be");
  assert.ok(d.languages.includes("go"));
  assert.ok(d.frameworks.includes("chi"));
});

test("non-extractable language reported, not claimed", () => {
  const d = inferStack(ev({ rootFiles: new Set(["pom.xml"]) }));
  assert.ok(d.languages.some((l) => l.startsWith("java (no extractor")));
});

test("monorepo signal → company type", () => {
  const d = inferStack(ev({ monorepo: true, rootFiles: new Set(["package.json"]) }));
  assert.equal(d.type, "company");
});
