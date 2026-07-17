/**
 * W8 eval + compression canary (CP8.7 + the gate).
 *
 *   npm run w8:eval            # grade W8's deterministic structure vs the goldens
 *   npm run w8:eval -- --canary  # also run the grounded compression money-shot
 *
 * Grades the DETERMINISTIC IncidentAnalysis against P2's golden outcomes on the
 * 4 live scenarios (1,2,3,5); scenario 4 (cyber) is reported STAGED (feed-gated),
 * not failed. The canary narrates scenario 1 through the W5 gateway (grounded,
 * cited, propose-not-execute) twice — proving the structure is stable across
 * reruns while prose may vary.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AppModule } from '../app.module';
import { IncidentReasoningService } from './incident-reasoning.service';
import { IncidentNarrationService } from './incident-narration.service';

const TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const T0_MS = Date.parse('2026-06-09T00:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LIVE = ['scenario-1', 'scenario-2', 'scenario-3', 'scenario-5'];
const log = new Logger('W8Eval');
const j = (o: unknown) => JSON.stringify(o, null, 2);

interface Check { name: string; pass: boolean; detail: string }

function windowFor(dayOffset: number, hours: number) {
  const start = T0_MS + dayOffset * DAY;
  return { from: new Date(start - 60_000), to: new Date(start + hours * HOUR + 60_000) };
}

async function main(): Promise<void> {
  const canary = process.argv.slice(2).includes('--canary');
  const goldenDir = path.resolve(process.cwd(), 'test/synthbank-p2/golden');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const reasoning = app.get(IncidentReasoningService);
  const narration = app.get(IncidentNarrationService);

  const graded: Array<{ scenario: string; pass: boolean; checks: Check[] }> = [];
  const staged: string[] = [];

  try {
    for (let n = 1; n <= 5; n++) {
      const id = `scenario-${n}`;
      const golden = JSON.parse(await fs.readFile(path.join(goldenDir, `${id}.json`), 'utf8'));
      if (!LIVE.includes(id)) {
        staged.push(`${id} (${golden.name}) — STAGED: ${golden.honestGaps?.[0] ?? 'feed-gated'}`);
        continue;
      }
      const window = windowFor(golden.window.dayOffset, golden.window.hours);
      const a = await reasoning.analyzeWindow({ tenantId: TENANT, window, packId: 'banking', scenario: id });
      const checks: Check[] = [];
      if (!a) {
        graded.push({ scenario: id, pass: false, checks: [{ name: 'analysis', pass: false, detail: 'no analysis produced' }] });
        continue;
      }

      // compression
      checks.push({ name: 'compression-ratio', pass: a.incident.compressionRatio === `${golden.correlation.rawAlertCount}:1`, detail: `${a.incident.compressionRatio} vs golden ${golden.correlation.rawAlertCount}:1` });
      // root
      if (golden.correlation.rootCiExternalId) {
        checks.push({ name: 'root-candidate', pass: a.incident.rootCandidateCiRefs.includes(golden.correlation.rootCiExternalId), detail: `${JSON.stringify(a.incident.rootCandidateCiRefs)} vs golden ${golden.correlation.rootCiExternalId}` });
      }
      // RCA smoking gun
      if (golden.rootCause.changeRef) {
        const top = a.rankedCauses[0];
        checks.push({ name: 'rca-smoking-gun-rank1', pass: !!top && top.changeRef === golden.rootCause.changeRef && top.rank === 1, detail: top ? `#1 ${top.changeRef} (score ${top.score})` : 'no ranked cause' });
      }
      // impact traversal-derived
      checks.push({ name: 'impact-services', pass: JSON.stringify(a.impact.services) === JSON.stringify([...golden.impact.expectedServices].sort()), detail: `${JSON.stringify(a.impact.services)} vs ${JSON.stringify([...golden.impact.expectedServices].sort())}` });
      checks.push({ name: 'impact-customers', pass: a.impact.customers === golden.impact.expectedCustomers, detail: `${a.impact.customers} vs ${golden.impact.expectedCustomers}` });
      checks.push({ name: 'impact-branches', pass: a.impact.branches === golden.impact.expectedBranches, detail: `${a.impact.branches} vs ${golden.impact.expectedBranches}` });
      // branch scope discrimination (scenario-3)
      if (id === 'scenario-3') {
        checks.push({ name: 'branch-local-scope', pass: a.classification?.scope === 'branch_local', detail: `scope=${a.classification?.scope} (must be branch_local, not estate-wide)` });
      }
      // propose-not-execute
      checks.push({ name: 'propose-not-execute', pass: a.recommendedAction.mode === 'propose' && a.recommendedAction.autoExecute === false, detail: `mode=${a.recommendedAction.mode}, autoExecute=${a.recommendedAction.autoExecute}` });
      // honest gaps present where golden declares them
      if (id === 'scenario-1') checks.push({ name: 'dr-gap-surfaced', pass: a.gaps.some((g) => g.degradedOutput === 'dr_posture_unknown'), detail: JSON.stringify(a.gaps) });
      if (id === 'scenario-5') checks.push({ name: 'customer-gap-surfaced', pass: a.gaps.some((g) => g.degradedOutput === 'customers_affected_unavailable'), detail: JSON.stringify(a.gaps) });

      graded.push({ scenario: `${id} (${golden.name})`, pass: checks.every((c) => c.pass), checks });
    }

    // Determinism: scenario-1 structured output stable across reruns.
    const w1 = windowFor(1, 6);
    const r1 = await reasoning.analyzeWindow({ tenantId: TENANT, window: w1, packId: 'banking', scenario: 'scenario-1' });
    const r2 = await reasoning.analyzeWindow({ tenantId: TENANT, window: w1, packId: 'banking', scenario: 'scenario-1' });
    const stable = !!r1 && !!r2 && JSON.stringify(structuralKey(r1)) === JSON.stringify(structuralKey(r2));

    const livePass = graded.every((g) => g.pass);
    // eslint-disable-next-line no-console
    console.log(j({ proof: 'W8 p2:eval grading', livePassRate: `${graded.filter((g) => g.pass).length}/${graded.length} live + ${staged.length} staged`, livePass, deterministic: stable, graded, staged }));

    if (canary) {
      const a = await reasoning.analyzeWindow({ tenantId: TENANT, window: w1, packId: 'banking', scenario: 'scenario-1' });
      const c1 = await narration.narrate(a!, TENANT, 'banking');
      const c2 = await narration.narrate(a!, TENANT, 'banking');
      const sorted = (x: string[]) => JSON.stringify([...x].sort());
      // eslint-disable-next-line no-console
      console.log(j({
        proof: 'W8 COMPRESSION MONEY-SHOT canary (grounded, cited, propose-not-execute)',
        structure: { compression: a!.incident.compressionRatio, root: a!.incident.rootCandidateCiRefs, topCause: a!.rankedCauses[0]?.changeRef, impact: a!.impact, drGap: a!.gaps.find((g) => g.degradedOutput === 'dr_posture_unknown') ?? null, action: a!.recommendedAction },
        grounded_answer: { grounded: c1.grounded, clearsHardReject: c1.grounded && !c1.declined, refs: c1.evidenceRefs, model: c1.model, content: c1.content },
        stable_on_rerun: { sameRefs: sorted(c1.evidenceRefs) === sorted(c2.evidenceRefs), groundedBoth: c1.grounded && c2.grounded },
      }));
    }
    if (!livePass || !stable) process.exit(3);
  } finally {
    await app.close();
  }
}

/** The structural (LLM-free) fields that must be reproducible across reruns. */
function structuralKey(a: NonNullable<Awaited<ReturnType<IncidentReasoningService['analyzeWindow']>>>) {
  return {
    compression: a.incident.compressionRatio,
    root: a.incident.rootCandidateCiRefs,
    members: [...a.incident.memberCiExternalIds].sort(),
    rca: a.rankedCauses.map((c) => `${c.rank}:${c.changeRef}:${c.score}`),
    impact: a.impact,
    scope: a.classification?.scope ?? null,
  };
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
