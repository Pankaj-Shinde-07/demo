import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS } from '../../src/datasource/import/synthbank-p2.scenarios';

/**
 * SynthBank P2 static guards (no DB): the composition invariant
 * (T-T0-CONTRADICTION) and exam↔answer-key alert-count consistency. The full
 * data-consistency proof against the seeded substrate is the live `npm run
 * p2:eval` harness; these are the durable CI guards.
 */

// The frozen t=0 pins (from synthbank-telemetry.seed.ts PINS) every arc must
// start from, so a scenario composes onto — never contradicts — t=0.
const T0_PINS: Record<string, Record<string, number>> = {
  'CI-0005': { latency_ms: 35, primary_saturation_pct: 22 },
  'CI-0002': { cpu_saturation_pct: 72, memory_saturation_pct: 81, primary_saturation_pct: 78 },
  'CI-0093': { latency_ms: 280, primary_saturation_pct: 85 },
  'CI-0027': { latency_ms: 95 },
};

describe('SynthBank P2 — composition + answer-key consistency (static)', () => {
  it('every scenario arc starts at the frozen t=0 pin (T-T0-CONTRADICTION)', () => {
    for (const sc of SCENARIOS) {
      for (const arc of sc.arcs) {
        const pin = T0_PINS[arc.ciExternalId]?.[arc.metric];
        expect({ ci: arc.ciExternalId, metric: arc.metric, from: arc.from }).toEqual({
          ci: arc.ciExternalId,
          metric: arc.metric,
          from: pin,
        });
      }
    }
  });

  it('each golden rawAlertCount equals the scenario alert count', () => {
    for (const sc of SCENARIOS) {
      const golden = JSON.parse(readFileSync(join(__dirname, 'golden', `${sc.id}.json`), 'utf8'));
      expect(golden.correlation.rawAlertCount).toBe(sc.alerts.length);
    }
  });

  it('the smoking-gun change is timed before the scenario’s first alert', () => {
    for (const sc of SCENARIOS) {
      if (!sc.change) continue;
      const firstAlertOffset = Math.min(...sc.alerts.map((a) => a.hourOffset));
      expect(sc.change.hourOffset).toBeLessThan(firstAlertOffset);
    }
  });

  it('scenario-3 stays branch-local (root is a single branch CI), scenario-4 is feed-gated', () => {
    const s3 = SCENARIOS.find((s) => s.id === 'scenario-3')!;
    expect(s3.rootCiExternalId).toBe('CI-0093');
    expect(s3.alerts.every((a) => a.ciExternalId === 'CI-0093')).toBe(true); // no estate-wide cascade
    const s4 = SCENARIOS.find((s) => s.id === 'scenario-4')!;
    expect(s4.securityFeedGated).toBe(true);
  });
});
