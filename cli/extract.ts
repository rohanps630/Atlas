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
import { extractNative, nativeLanguages } from "../extractors/native/index.js";
import { extractGo } from "../extractors/go/index.js";
import { newStats, toCallResolution, type CallResolution } from "../extractors/shared/resolve.js";
import type { ExtractorOutput } from "../core/schema.js";

export interface RepoExtraction {
  output: ExtractorOutput;
  /** Per-language function counts, for reporting (only languages that matched). */
  perLanguage: { language: string; functions: number }[];
  /** Call-resolution coverage for the repo, summed across its languages (ADR 0013). */
  resolution: CallResolution;
}

export function extractRepoAll(repoPath: string, repoId: string): RepoExtraction {
  // One stats accumulator shared across the repo's languages → a per-repo total.
  const stats = newStats();
  const ts = extractRepo({ repoPath, repoId }, stats);
  const outputs: ExtractorOutput[] = [ts];
  const perLanguage = [{ language: "typescript", functions: fnCount(ts) }];

  // Every registered tree-sitter language (Swift, Kotlin, …) runs automatically.
  for (const language of nativeLanguages()) {
    const out = extractNative({ repoPath, repoId, language }, stats);
    const functions = fnCount(out);
    if (functions > 0) {
      outputs.push(out);
      perLanguage.push({ language, functions });
    }
  }

  const go = extractGo({ repoPath, repoId }, stats);
  const goFns = fnCount(go);
  if (goFns > 0) {
    outputs.push(go);
    perLanguage.push({ language: "go", functions: goFns });
  }

  return { output: merge(outputs), perLanguage, resolution: toCallResolution(stats) };
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
