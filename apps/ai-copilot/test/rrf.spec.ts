import {
  reciprocalRankFusion,
  RankedHit,
  RRF_K,
  RRF_WEIGHTS,
} from '../src/retrieval/rrf';

const hit = (chunkId: string, rank: number, score = 0): RankedHit => ({
  chunkId,
  rank,
  score,
});

describe('reciprocalRankFusion (W4 §4)', () => {
  it('uses k=60 by default', () => {
    expect(RRF_K).toBe(60);
  });

  it('scores a single list as 1/(k+rank)', () => {
    const fused = reciprocalRankFusion([[hit('a', 1), hit('b', 2)]]);
    expect(fused[0].chunkId).toBe('a');
    expect(fused[0].rrfScore).toBeCloseTo(1 / (60 + 1), 10);
    expect(fused[1].rrfScore).toBeCloseTo(1 / (60 + 2), 10);
  });

  it('sums contributions across lists (unweighted)', () => {
    // "x" is rank 2 in dense and rank 1 in sparse; "y" is rank 1 in dense only.
    const dense = [hit('y', 1), hit('x', 2)];
    const sparse = [hit('x', 1), hit('z', 2)];
    const fused = reciprocalRankFusion([dense, sparse]);

    const x = fused.find((f) => f.chunkId === 'x')!;
    const y = fused.find((f) => f.chunkId === 'y')!;
    expect(x.rrfScore).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(y.rrfScore).toBeCloseTo(1 / 61, 10);
    // x appears in both lists, so it should outrank y which appears in one.
    expect(fused[0].chunkId).toBe('x');
  });

  it('applies per-list weights (dense-biased 4:1)', () => {
    // dense ranks 'd' at 1; sparse ranks 's' at 1. With [4,1], dense's hit wins.
    const dense = [hit('d', 1)];
    const sparse = [hit('s', 1)];
    const fused = reciprocalRankFusion([dense, sparse], RRF_K, [4, 1]);
    const d = fused.find((f) => f.chunkId === 'd')!;
    const s = fused.find((f) => f.chunkId === 's')!;
    expect(d.rrfScore).toBeCloseTo(4 / 61, 10);
    expect(s.rrfScore).toBeCloseTo(1 / 61, 10);
    expect(fused[0].chunkId).toBe('d'); // dense-preferred chunk leads under 4:1
  });

  it('defaults to equal weighting when weights omitted', () => {
    const fused = reciprocalRankFusion([[hit('a', 1)], [hit('a', 1)]]);
    expect(fused[0].rrfScore).toBeCloseTo(2 / 61, 10); // 1/61 + 1/61
  });

  it('exposes the chosen default weights as [dense, sparse] = [4, 1]', () => {
    expect(RRF_WEIGHTS).toEqual([4, 1]);
  });

  it('records per-list ranks (index 0 dense, 1 sparse), null when absent', () => {
    const fused = reciprocalRankFusion([[hit('a', 1)], [hit('a', 3)]]);
    expect(fused[0].ranksByList).toEqual([1, 3]);

    const onlyDense = reciprocalRankFusion([[hit('a', 1)], []]);
    expect(onlyDense[0].ranksByList).toEqual([1, null]);
  });

  it('is deterministic on ties (tiebreak by chunkId)', () => {
    const a = reciprocalRankFusion([[hit('b', 1), hit('a', 1)]]);
    // both rank 1 → equal score → sorted by chunkId asc
    expect(a.map((f) => f.chunkId)).toEqual(['a', 'b']);
  });

  it('returns empty for empty input', () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});
