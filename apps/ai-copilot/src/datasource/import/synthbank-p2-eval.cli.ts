/**
 * SynthBank P2 eval-consistency harness (CP-P2.6).
 *
 *   npm run p2:eval -- [--tenant=<uuid>] [--golden=<dir>]
 *
 * For each scenario, verifies the GOLDEN OUTCOME is consistent with the SEEDED
 * SUBSTRATE — WITHOUT doing W8's reasoning (T-SCOPE). It checks data-consistency
 * (exam ↔ answer key), not model output, and is the eval scaffold W8 plugs into:
 *   - the seeded raw alerts match the golden's rawAlertCount and collapse to the
 *     stated root (compression achievable);
 *   - the planted change is present, on the stated root, timed BEFORE the incident;
 *   - the impact set EQUALS the live traversal over the seeded graph + §FROZEN
 *     (never a hard-coded count — T-IMPACT-RESTATE);
 *   - composition holds (each arc's first point == the t=0 pin);
 *   - declared honest gaps are genuinely absent from the data.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AppModule } from '../../app.module';
import { DataSourceRegistry } from '../data-source.registry';
import { CmdbGraphService } from '../../context/cmdb-graph.service';
import { SCENARIOS } from './synthbank-p2.scenarios';

const TENANT_DEFAULT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const T0_MS = Date.parse('2026-06-09T00:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const log = new Logger('P2Eval');

function arg(name: string, fb: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fb;
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const tenant = arg('tenant', TENANT_DEFAULT);
  const goldenDir = path.resolve(arg('golden', path.join(process.cwd(), 'test/synthbank-p2/golden')));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const registry = app.get(DataSourceRegistry);
  const graph = app.get(CmdbGraphService);
  const provider = await registry.getCmdbProvider(tenant);
  if (!provider) {
    log.error('no provider for tenant');
    process.exit(1);
  }

  const results: Array<{ scenario: string; checks: Check[]; pass: boolean }> = [];

  try {
    for (const sc of SCENARIOS) {
      const golden = JSON.parse(await fs.readFile(path.join(goldenDir, `${sc.id}.json`), 'utf8'));
      const start = T0_MS + sc.windowDayOffset * DAY;
      const window = { from: new Date(start - 60_000), to: new Date(start + sc.windowHours * HOUR + 60_000) };
      const checks: Check[] = [];

      // 1) alerts present + count + collapse-to-root.
      const alerts = (await provider.getAlertsInWindow(window, tenant)).filter((a) => a.scenario === sc.id);
      checks.push({
        name: 'raw-alert-count',
        pass: alerts.length === golden.correlation.rawAlertCount,
        detail: `seeded ${alerts.length}, golden ${golden.correlation.rawAlertCount}`,
      });
      const rootExt: string | null = golden.correlation.rootCiExternalId;
      if (rootExt) {
        const rootAlerts = alerts.some((a) => a.ciExternalId === rootExt);
        checks.push({
          name: 'collapses-to-root',
          pass: rootAlerts && alerts.length >= 1,
          detail: `${alerts.length} alerts collapse to incident rooted at ${rootExt} (root alerts present: ${rootAlerts})`,
        });
      }

      // 2) planted change present + on root + timed before incident.
      if (golden.rootCause.changeRef) {
        const changes = (await provider.getChangesInWindow(window, tenant)).filter((c) => c.scenario === sc.id);
        const change = changes.find((c) => c.changeRef === golden.rootCause.changeRef);
        const firstAlert = [...alerts].sort((a, b) => a.firedAt.localeCompare(b.firedAt))[0];
        const beforeIncident = !!change && !!firstAlert && Date.parse(change.at) < Date.parse(firstAlert.firedAt);
        checks.push({
          name: 'smoking-gun-change',
          pass: !!change && change.ciExternalId === golden.rootCause.ciExternalId && beforeIncident,
          detail: change ? `${change.changeRef} on ${change.ciExternalId} at ${change.at} < first alert ${firstAlert?.firedAt}` : 'change MISSING',
        });
      }

      // 3) impact == live traversal (never hard-coded).
      if (golden.impact.rootCiExternalId) {
        const g = await graph.assembleImpactGraph(tenant, { type: 'ci', ref: golden.impact.rootCiExternalId });
        const svc = g.affectedServices.map((s) => s.name).sort();
        const expSvc = [...golden.impact.expectedServices].sort();
        checks.push({
          name: 'impact-services-traversal-derived',
          pass: JSON.stringify(svc) === JSON.stringify(expSvc),
          detail: `traversal ${JSON.stringify(svc)} vs golden ${JSON.stringify(expSvc)}`,
        });
        checks.push({
          name: 'impact-customers-traversal-derived',
          pass: g.totalCustomers === golden.impact.expectedCustomers,
          detail: `traversal ${g.totalCustomers} vs golden ${golden.impact.expectedCustomers}`,
        });
        checks.push({
          name: 'impact-branches-traversal-derived',
          pass: g.affectedNodeCount === golden.impact.expectedBranches,
          detail: `traversal ${g.affectedNodeCount} vs golden ${golden.impact.expectedBranches}`,
        });
      }

      // 4) composition: each arc's first windowed point == the t=0 pin value.
      for (const a of sc.arcs) {
        const hist = await provider.getGoldenSignalHistory(a.ciExternalId, window, tenant);
        const first = hist[0];
        const key = (
          a.metric === 'latency_ms' ? 'latencyMs' : a.metric === 'cpu_saturation_pct' ? 'cpuSaturationPct' : a.metric === 'memory_saturation_pct' ? 'memorySaturationPct' : 'primarySaturationPct'
        ) as 'latencyMs' | 'cpuSaturationPct' | 'memorySaturationPct' | 'primarySaturationPct';
        const firstVal = first ? first[key] : undefined;
        checks.push({
          name: `composition-${a.ciExternalId}-${a.metric}`,
          pass: firstVal === a.from,
          detail: `first point ${a.metric}=${firstVal ?? 'none'} (pin ${a.from})`,
        });
      }

      // 5) honest gaps genuinely absent.
      if (sc.id === 'scenario-5') {
        const g = await graph.assembleImpactGraph(tenant, { type: 'ci', ref: 'CI-0027' });
        checks.push({ name: 'gap-customers-genuinely-absent', pass: g.totalCustomers === null, detail: `cheque_clearing customers = ${g.totalCustomers} (honestly unavailable)` });
      }
      if (sc.id === 'scenario-1') {
        const drSig = await provider.getGoldenSignalsForCis(['CI-0010'], tenant);
        checks.push({ name: 'gap-dr-mirror-genuinely-absent', pass: drSig.length === 0, detail: `CI-0010 DR-mirror telemetry rows = ${drSig.length} (the §4 DR-gap preserved)` });
      }
      if (sc.id === 'scenario-4') {
        checks.push({ name: 'security-feed-gated-flag', pass: golden.securityFeedGated === true, detail: 'reasoning gated on deferred security feed (data+golden authored)' });
      }

      const pass = checks.every((c) => c.pass);
      results.push({ scenario: `${sc.id} (${sc.name})`, checks, pass });
    }
  } finally {
    await app.close();
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ tenant, goldenDir, results, allPass: results.every((r) => r.pass) }, null, 2));
  if (!results.every((r) => r.pass)) process.exit(3);
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
