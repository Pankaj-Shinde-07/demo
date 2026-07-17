import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SCENARIOS,
  type Arc,
  type ScenarioDef,
} from './synthbank-p2.scenarios';

/**
 * SynthBank P2 behaviour generator (the motion layer). Composes alert streams,
 * moving golden-signal arcs, and the planted "smoking-gun" change onto the frozen
 * t=0 telemetry, seeded into the self-owned substrate (per-CI `attributes` jsonb:
 * `p2_history` / `p2_alerts` / `p2_change`) — additive, NO copilot-schema
 * migration. Read back through the vendor-neutral windowed provider methods
 * (getGoldenSignalHistory / getAlertsInWindow / getChangesInWindow).
 *
 * DETERMINISM (T-DETERMINISM): every value is arc interpolation; every timestamp
 * is `t0 + dayOffset + hourOffset`. No wall-clock, no RNG → re-seed is
 * byte-identical, and the combined t=0 + P2 dataset is md5-stable.
 *
 * COMPOSITION (T-T0-CONTRADICTION): each arc's first point equals the §3 t=0 pin
 * (enforced in the scenario data + asserted by the eval harness).
 *
 * This is the test substrate ONLY — no correlation/RCA reasoning lives here
 * (T-SCOPE: that is W8, graded against the golden outcomes by the eval harness).
 */

const T0_MS = Date.parse('2026-06-09T00:00:00.000Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface CiBucket {
  history: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  change: Array<Record<string, unknown>>;
}

export interface P2SeedSummary {
  tenantId: string;
  scenariosSeeded: string[];
  cisTouched: number;
  alertsSeeded: number;
  changesSeeded: number;
  t0: string;
  deterministic: true;
}

@Injectable()
export class SynthBankP2SeedService {
  private readonly logger = new Logger(SynthBankP2SeedService.name);

  constructor(private readonly db: DataSource) {}

  async seed(tenantId: string): Promise<P2SeedSummary> {
    const buckets = new Map<string, CiBucket>();
    const bucket = (ext: string): CiBucket => {
      let b = buckets.get(ext);
      if (!b) {
        b = { history: [], alerts: [], change: [] };
        buckets.set(ext, b);
      }
      return b;
    };

    let alertsSeeded = 0;
    let changesSeeded = 0;

    for (const sc of SCENARIOS) {
      const start = T0_MS + sc.windowDayOffset * DAY_MS;
      const at = (hourOffset: number) => new Date(start + hourOffset * HOUR_MS).toISOString();

      // 1) arcs → per-CI hourly history points (first point == t=0 pin value).
      const arcsByCi = new Map<string, Arc[]>();
      for (const a of sc.arcs) {
        const list = arcsByCi.get(a.ciExternalId) ?? [];
        list.push(a);
        arcsByCi.set(a.ciExternalId, list);
      }
      for (const [ext, arcs] of arcsByCi) {
        for (let h = 0; h <= sc.windowHours; h++) {
          const t = h / sc.windowHours;
          const point: Record<string, unknown> = { at: at(h), scenario: sc.id };
          for (const arc of arcs) point[arc.metric] = lerp(arc.from, arc.to, t);
          bucket(ext).history.push(point);
        }
      }

      // 2) alert stream.
      for (const al of sc.alerts) {
        bucket(al.ciExternalId).alerts.push({
          alert_id: `${sc.id}:${al.ciExternalId}:${al.hourOffset}:${al.metric}`,
          scenario: sc.id,
          severity: al.severity,
          fired_at: at(al.hourOffset),
          metric: al.metric,
          message: al.message,
        });
        alertsSeeded++;
      }

      // 3) planted change (the RCA smoking gun) — timed before the first alert.
      if (sc.change) {
        bucket(sc.change.ciExternalId).change.push({
          change_ref: sc.change.changeRef,
          scenario: sc.id,
          change_type: sc.change.changeType,
          at: at(sc.change.hourOffset),
          summary: sc.change.summary,
          risk: sc.change.risk,
          role: sc.change.role,
        });
        changesSeeded++;
      }
    }

    // Write each touched CI's buckets into attributes jsonb (idempotent merge).
    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      for (const [ext, b] of buckets) {
        const merge: Record<string, unknown> = {};
        if (b.history.length) merge.p2_history = b.history;
        if (b.alerts.length) merge.p2_alerts = b.alerts;
        if (b.change.length) merge.p2_change = b.change;
        const res = await runner.query(
          `UPDATE cmdb_configuration_items
              SET attributes = attributes || $3::jsonb, updated_at = now()
            WHERE tenant_id = $1 AND ci_external_id = $2 AND deleted_at IS NULL`,
          [tenantId, ext, JSON.stringify(merge)],
        );
        if (Array.isArray(res) && res.length === 0) {
          this.logger.warn(`P2 seed: CI ${ext} not found for tenant ${tenantId} (scenario data dropped)`);
        }
      }
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }

    return {
      tenantId,
      scenariosSeeded: SCENARIOS.map((s: ScenarioDef) => s.id),
      cisTouched: buckets.size,
      alertsSeeded,
      changesSeeded,
      t0: new Date(T0_MS).toISOString(),
      deterministic: true,
    };
  }
}

function lerp(a: number, b: number, t: number): number {
  return Math.round((a + (b - a) * t) * 10) / 10;
}
