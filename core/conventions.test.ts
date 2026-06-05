import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "./graph.js";
import { conventions } from "./conventions.js";
import type { AtlasEdge, AtlasNode } from "./schema.js";

function fn(repo: string, file: string, name: string): AtlasNode {
  return { id: `${repo}:${file}#${name}`, kind: "function", name, file, line: 1 };
}

const nodes: AtlasNode[] = [
  fn("web", "src/services/clinic-service.ts", "list"),
  fn("web", "src/services/user-service.ts", "list"),
  fn("web", "src/services/plan-service.ts", "list"),
  fn("web", "src/hooks/useAuth.ts", "useAuth"),
  fn("web", "src/hooks/useStats.ts", "useStats"),
];
// make clinic-service the most-used (exemplar)
const edges: AtlasEdge[] = [
  { from: "web:src/hooks/useAuth.ts#useAuth", to: "web:src/services/clinic-service.ts#list", kind: "call", line: 1 },
  { from: "web:src/hooks/useStats.ts#useStats", to: "web:src/services/clinic-service.ts#list", kind: "call", line: 1 },
];

test("detects layers, naming patterns, and the exemplar by in-degree", () => {
  const g = new Graph(nodes, edges);
  const out = conventions(g, { minFiles: 2 });

  const services = out.find((l) => l.layer === "services")!;
  assert.equal(services.dir, "src/services");
  assert.equal(services.files, 3);
  assert.equal(services.naming, "*-service.ts");
  assert.equal(services.exemplar?.file, "src/services/clinic-service.ts");

  const hooks = out.find((l) => l.layer === "hooks")!;
  assert.equal(hooks.naming, "use*.ts");
});

test("layers below minFiles are skipped", () => {
  const g = new Graph([fn("web", "src/services/only.ts", "x")], []);
  assert.equal(conventions(g, { minFiles: 2 }).length, 0);
});
