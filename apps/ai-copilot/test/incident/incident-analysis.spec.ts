import {
  buildTimeline,
  classifyBranchFailure,
  computeConfidence,
  rankRootCauses,
  recommendAction,
} from '../../src/incident/incident-analysis';
import type { AlertRecord, ChangeEvent } from '../../src/datasource/data-source.types';

/**
 * W8 deterministic reasoning proofs (no DB, no LLM). The full live grading vs the
 * golden outcomes is `npm run w8:eval`; these are the durable CI guards for the
 * deterministic layer.
 */

function alert(ci: string, metric: string, message: string, firedAt: string, severity: AlertRecord['severity'] = 'critical'): AlertRecord {
  return { alertId: `${ci}:${metric}`, ciExternalId: ci, ciName: ci, severity, firedAt, metric, message, scenario: 's' };
}
function change(ci: string, at: string, ref = 'CHG-1'): ChangeEvent {
  return { changeRef: ref, ciExternalId: ci, ciName: ci, at, changeType: 'config', summary: 'cfg', risk: 'medium', role: 'caused_by', scenario: 's' };
}

describe('W8 deterministic analysis', () => {
  it('ranks the on-root recent change #1 (smoking gun), an after-onset change ~0', () => {
    const onset = Date.parse('2026-06-11T02:00:00Z');
    const dist = new Map([['CI-0002', 0], ['CI-FAR', 5]]);
    const ranked = rankRootCauses(
      [
        change('CI-0002', '2026-06-11T01:00:00Z', 'CHG-SMOKING'), // 1h before onset, on root
        change('CI-FAR', '2026-06-10T01:00:00Z', 'CHG-FAR'), // far + 25h before
        change('CI-0002', '2026-06-11T03:00:00Z', 'CHG-AFTER'), // after onset → not causal
      ],
      dist,
      onset,
    );
    expect(ranked[0].changeRef).toBe('CHG-SMOKING');
    expect(ranked[0].rank).toBe(1);
    const after = ranked.find((r) => r.changeRef === 'CHG-AFTER')!;
    expect(after.score).toBe(0); // after onset contributes no recency score
  });

  it('classifies a single-branch failure as branch_local (discrimination), cause indeterminate', () => {
    const c = classifyBranchFailure(
      true,
      [alert('CI-0093', 'availability', 'Branch Router unreachable', '2026-06-12T03:00:00Z')],
      1,
    );
    expect(c.scope).toBe('branch_local'); // NOT estate-wide
    expect(c.pattern).toBe('indeterminate');
    expect(c.note).toMatch(/not determinable/);
  });

  it('classifies multi-branch unreachable as hub_cluster', () => {
    const c = classifyBranchFailure(
      true,
      [alert('A', 'availability', 'unreachable', 't'), alert('B', 'availability', 'unreachable', 't')],
      8,
    );
    expect(c.scope).toBe('hub_cluster');
    expect(c.pattern).toBe('site_or_power');
  });

  it('recommendAction is ALWAYS propose / autoExecute=false (T-AUTO-EXECUTE)', () => {
    const variants = [
      recommendAction('X', { changeRef: 'C', ciExternalId: 'x', at: 't', summary: 's', proximity: 0, recencyHours: 1, score: 9, rank: 1 }, null),
      recommendAction('Branch', null, { isBranchFailure: true, pattern: 'indeterminate', scope: 'branch_local', affectedBranchCount: 1, note: '' }),
      recommendAction('Root', null, null),
      recommendAction(null, null, null),
    ];
    for (const v of variants) {
      expect(v.mode).toBe('propose');
      expect(v.autoExecute).toBe(false);
    }
  });

  it('confidence drops for DR-gap / indeterminate / ungrounded impact', () => {
    expect(computeConfidence({ impactGrounded: true, changeExpectedButMissing: false, causeIndeterminate: false, drGap: false, securityFeedGated: false }).level).toBe('high');
    const low = computeConfidence({ impactGrounded: false, changeExpectedButMissing: true, causeIndeterminate: true, drGap: true, securityFeedGated: false });
    expect(low.level).toBe('low');
    expect(low.score).toBeLessThan(0.5);
  });

  it('timeline orders change before its caused alerts', () => {
    const tl = buildTimeline(
      [alert('CI-0002', 'sat', 'high', '2026-06-11T02:00:00Z'), alert('CI-0025', 'lat', 'timeout', '2026-06-11T05:00:00Z')],
      change('CI-0002', '2026-06-11T01:00:00Z', 'CHG-1'),
    );
    expect(tl[0].kind).toBe('change');
    expect(tl.map((e) => e.at)).toEqual([...tl.map((e) => e.at)].sort());
  });
});
