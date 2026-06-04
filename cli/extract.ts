/**
 * Per-repo extraction orchestration: run every applicable language extractor
 * over a repo and merge the results into one normalized topology.
 *
 * A repo (e.g. a React Native app) can hold TypeScript plus native Swift/Kotlin
 * modules. Each extractor emits the same schema; merging keeps them in one
 * repo's graph so `context`/`impact` span the whole codebase. The core never
 * sees this orchestration — it only ever consumes the merged JSON (ADR 0005).
 */

import { extractRepo } from "../extractors/typescript/index.js";
import { extractNative, type NativeLanguage } from "../extractors/native/index.js";
import type { ExtractorOutput } from "../core/schema.js";

export interface RepoExtraction {
  output: ExtractorOutput;
  /** Per-language function counts, for reporting (only languages that matched). */
  perLanguage: { language: string; functions: number }[];
}

const NATIVE: NativeLanguage[] = ["swift", "kotlin"];

export function extractRepoAll(repoPath: string, repoId: string): RepoExtraction {
  const ts = extractRepo({ repoPath, repoId });
  const outputs: ExtractorOutput[] = [ts];
  const perLanguage = [{ language: "typescript", functions: fnCount(ts) }];

  for (const language of NATIVE) {
    const out = extractNative({ repoPath, repoId, language });
    const functions = fnCount(out);
    if (functions > 0) {
      outputs.push(out);
      perLanguage.push({ language, functions });
    }
  }

  return { output: merge(outputs), perLanguage };
}

function merge(outputs: ExtractorOutput[]): ExtractorOutput {
  const base = outputs[0]!;
  return {
    schemaVersion: base.schemaVersion,
    repo: base.repo,
    generatedAt: base.generatedAt,
    nodes: outputs.flatMap((o) => o.nodes),
    edges: outputs.flatMap((o) => o.edges),
    endpoints: {
      consumes: outputs.flatMap((o) => o.endpoints.consumes),
      exposes: outputs.flatMap((o) => o.endpoints.exposes),
    },
  };
}

function fnCount(o: ExtractorOutput): number {
  return o.nodes.reduce((n, node) => (node.kind === "function" ? n + 1 : n), 0);
}
