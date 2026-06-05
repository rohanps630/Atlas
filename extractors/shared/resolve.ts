/**
 * Shared call-resolution policy for the tree-sitter extractors (ADR 0012).
 *
 * Both the Go and native (Swift/Kotlin) extractors resolve a call to at most one
 * target node by trying candidate sets in **descending order of precision**
 * (receiver/type → same-scope → repo-global) and emitting an edge ONLY when a
 * layer narrows to exactly one candidate. The language-specific computation of
 * each layer's candidates lives in each extractor (Go syntax vs. Kotlin/Swift
 * syntax); this module owns the **ordering policy** and the per-repo **counters**
 * so the two extractors can't drift.
 *
 * No schema change: the counters are reported out-of-band (an optional out-param),
 * never written into the normalized JSON the core consumes (ADR 0005).
 */

/** Which layer resolved a call — also the breakdown reported for measurement. */
export type ResolveVia = "receiver" | "scope" | "global";

/**
 * Per-repo resolution counters. `viaGlobal` alone reproduces the pre-ADR-0012
 * behavior (global-unique only), so a single instrumented run yields the
 * before/after comparison: before = viaGlobal; after = resolved.
 */
export interface ResolutionStats {
  total: number; // call sites considered
  resolved: number; // resolved to a node by any layer (= viaReceiver+viaScope+viaGlobal)
  viaReceiver: number;
  viaScope: number;
  viaGlobal: number;
  skippedAmbiguous: number; // the deciding layer offered >1 candidate; refuse to guess
  skippedSelf: number; // the only candidate was the caller itself (no self-edge)
  unresolved: number; // no layer had any candidate (library/external/undeclared target)
}

export function newStats(): ResolutionStats {
  return {
    total: 0,
    resolved: 0,
    viaReceiver: 0,
    viaScope: 0,
    viaGlobal: 0,
    skippedAmbiguous: 0,
    skippedSelf: 0,
    unresolved: 0,
  };
}

/** One precision layer's candidate node ids. An empty array means "no opinion". */
export interface Layer {
  via: ResolveVia;
  candidates: string[];
}

export interface Resolved {
  to: string;
  via: ResolveVia;
}

/**
 * Apply `layers` in order and decide a call's target. The **first** layer with a
 * non-empty candidate set is the decision point:
 *  - exactly one candidate, and it isn't the caller → resolved via that layer;
 *  - the one candidate is the caller itself → no edge (self-call);
 *  - more than one candidate → ambiguous at the most precise layer that had an
 *    opinion; we refuse to guess (and do NOT fall through to a broader, even less
 *    precise layer — that would only be more ambiguous, or unique by accident).
 * A layer with no candidates falls through to the next. If no layer has an
 * opinion, the call is unresolved (a library / external / undeclared target).
 *
 * This is monotonic over the old global-only policy: putting `global` last
 * reproduces every edge it used to resolve, and the earlier layers only add
 * edges for calls that global left ambiguous. So edges are added, never changed.
 */
export function resolveCall(
  self: string,
  layers: Layer[],
  stats: ResolutionStats,
): Resolved | undefined {
  stats.total++;
  for (const layer of layers) {
    const c = layer.candidates;
    if (c.length === 0) continue; // no opinion → next layer
    if (c.length === 1) {
      if (c[0] === self) {
        stats.skippedSelf++;
        return undefined;
      }
      stats.resolved++;
      if (layer.via === "receiver") stats.viaReceiver++;
      else if (layer.via === "scope") stats.viaScope++;
      else stats.viaGlobal++;
      return { to: c[0]!, via: layer.via };
    }
    stats.skippedAmbiguous++; // >1 at the deciding layer → refuse to guess
    return undefined;
  }
  stats.unresolved++;
  return undefined;
}
