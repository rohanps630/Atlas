import { test } from "node:test";
import assert from "node:assert/strict";
import { systemDiagram } from "./mermaid.js";
import type { MergedMap } from "./schema.js";

const map: MergedMap = {
  schemaVersion: 0,
  workspace: "ws",
  generatedAt: "t",
  repos: ["web", "svc"],
  crossRepoEdges: [
    { from: "web:src/orders.ts#createOrder", to: "svc:h.go#Create", kind: "http", contract: "POST /api/orders" },
  ],
  externalNodes: [
    { id: "external:GET /api/payments", reason: "x", consumedBy: ["web:src/pay.ts#charge"] },
  ],
};

test("systemDiagram renders subgraphs, a contract edge, and an external edge", () => {
  const d = systemDiagram(map);
  assert.match(d, /^flowchart LR/);
  assert.match(d, /subgraph web\["web"\]/);
  assert.match(d, /subgraph svc\["svc"\]/);
  assert.match(d, /subgraph external\["external"\]/);
  assert.match(d, /-->\|"POST \/api\/orders"\|/); // resolved contract
  assert.match(d, /-\.->\|"GET \/api\/payments"\|/); // external (dashed)
});

test("empty map yields a placeholder, not a crash", () => {
  const d = systemDiagram({ ...map, crossRepoEdges: [], externalNodes: [] });
  assert.match(d, /no cross-repo links yet/);
});
