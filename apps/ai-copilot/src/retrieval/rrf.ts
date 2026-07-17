/**
 * Reciprocal Rank Fusion (W4 §4, D5; weighted per the W4 RRF tuning pass, 2026-06-08).
 *
 * score(d) = Σ_lists w_list · 1 / (k + rank_list(d)), with k = 60 and rank 1-based.
 *
 * Weights default to equal (unweighted) when omitted. The retrieval service passes
 * a dense-biased weight (RRF_WEIGHTS, [dense, sparse] = [4, 1]) chosen by the bounded
 * RRF tuning experiment: on the 346-chunk SynthBank corpus, equal weighting let the
 * weak sparse path dilute the strong dense path (fused recall@10 0.865 < dense 0.887);
 * 4:1 restores fused ≥ dense (0.898) while preserving exact-token wins (sparse still
 * lifts exact CI rows to #1) and the CMDB-class recall. See
 * `docs/ai-copilot/RETRIEVAL_BASELINE.md` (RRF tuning section). 2:1/3:1 did not close
 * the recall@10 gap; OR-semantics on the sparse query degraded CMDB recall.
 *
 * Pure and side-effect free so it is unit-testable without a DB or the model.
 */

/** A single ranked hit from one retrieval list. `rank` is 1-based. */
export interface RankedHit {
  chunkId: string;
  rank: number;
  /** Raw per-mode score (cosine similarity or ts_rank_cd), for transparency. */
  score: number;
}

/** A fused result. `ranksByList[i]` is this chunk's 1-based rank in input list i, or null. */
export interface FusedHit {
  chunkId: string;
  rrfScore: number;
  ranksByList: (number | null)[];
}

/** Canonical RRF constant (D5 / v1.3 spec). */
export const RRF_K = 60;

/**
 * Default fusion weights, by list index [dense, sparse]. Dense-biased 4:1 per the
 * W4 RRF tuning pass (2026-06-08). Equal weighting (1:1) is the prior baseline.
 */
export const RRF_WEIGHTS = [4, 1];

/**
 * Fuse N ranked lists into one RRF-ordered list. Input list order is preserved
 * in `ranksByList` (caller decides index 0 = dense, 1 = sparse, etc.).
 * `weights[i]` scales list i's contribution (defaults to 1 per list = unweighted).
 * Ties broken by chunkId for deterministic output.
 */
export function reciprocalRankFusion(
  lists: RankedHit[][],
  k: number = RRF_K,
  weights?: number[],
): FusedHit[] {
  const byId = new Map<string, FusedHit>();

  lists.forEach((list, listIndex) => {
    const w = weights?.[listIndex] ?? 1;
    for (const hit of list) {
      let entry = byId.get(hit.chunkId);
      if (!entry) {
        entry = {
          chunkId: hit.chunkId,
          rrfScore: 0,
          ranksByList: lists.map(() => null),
        };
        byId.set(hit.chunkId, entry);
      }
      entry.rrfScore += w / (k + hit.rank);
      entry.ranksByList[listIndex] = hit.rank;
    }
  });

  return [...byId.values()].sort(
    (a, b) => b.rrfScore - a.rrfScore || a.chunkId.localeCompare(b.chunkId),
  );
}
