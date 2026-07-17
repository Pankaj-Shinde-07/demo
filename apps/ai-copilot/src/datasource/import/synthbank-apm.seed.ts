import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * ADR-006 Tier-B (app-layer) APM seed — labeled-synthetic, demo mode.
 *
 * Writes a per-CI `attributes->'apm_tier_b'` block (mirroring the Tier-A
 * `golden_signal` key) — additively, NO copilot-schema migration. Read back
 * through the portable getServicePerformance method (SeedApmDataSource), never
 * the substrate directly. Vertical-data boundary: SynthBank/banking literals
 * legitimately live in this seed (outside the §6.6 engine seam).
 *
 * DETERMINISM: every value is a frozen constant at the seed t0 — no wall-clock,
 * no Math.random — so a re-seed is byte-identical and APM figures never drift.
 *
 * Point-in-time ONLY: one current reading + its baseline per signal. NO
 * percentiles (a single reading is not a distribution) and NO time-series
 * (avoids the trend-trap). Values reconcile with the Tier-A golden signals
 * (CP-P3.1a-approved §2/§3): CI-0002 connections 78% → query 65ms (3.6× of 18);
 * CI-0001 disk 88% + waits on slow DB → response 280ms (2.5× of 110); upi_imps
 * via CI-0004 (healthy switch) + CI-0005 sponsor-link 0.1% loss → success 98.6%
 * (baseline 99.7%), below the 99% NPCI/RBI technical-decline watch line.
 *
 * Delta-2 NOTE (TODO): UPI success-rate is a SERVICE property but is seeded on
 * CI-0004 (the UPI switch / txn-processing app node) because cmdb_business_services
 * has no attributes column. getServicePerformance('upi_imps') resolves it via the
 * service→CI link. Move to a service-row column when the schema migration phase runs.
 */
const T0_ISO = '2026-06-09T00:00:00.000Z';

interface TierBSeed {
  signals: Array<{ metric: string; value: number; unit: 'ms' | 'pct'; baseline: number }>;
}

/** Frozen, approved (CP-P3.1a §2) point-in-time readings + baselines. */
const SEEDS: Record<string, TierBSeed> = {
  // CBS DB query time — degraded by connection-pool saturation (Tier-A 78%).
  'CI-0002': { signals: [{ metric: 'query_time', value: 65, unit: 'ms', baseline: 18 }] },
  // CBS app-server response time — inflated by the slow DB + disk 88%.
  'CI-0001': { signals: [{ metric: 'response_time', value: 280, unit: 'ms', baseline: 110 }] },
  // UPI success rate — service signal on CI-0004 (TODO: move to service row).
  'CI-0004': { signals: [{ metric: 'success_rate', value: 98.6, unit: 'pct', baseline: 99.7 }] },
};

@Injectable()
export class SynthBankApmSeedService {
  private readonly logger = new Logger(SynthBankApmSeedService.name);

  constructor(private readonly db: DataSource) {}

  async seed(tenantId: string): Promise<{ seeded: Array<{ ci: string; metrics: string[] }> }> {
    const seeded: Array<{ ci: string; metrics: string[] }> = [];
    for (const [ciExternalId, seed] of Object.entries(SEEDS)) {
      const block = { synthetic: true, reading_at: T0_ISO, signals: seed.signals };
      const res = await this.db.query(
        `UPDATE cmdb_configuration_items
            SET attributes = jsonb_set(attributes, '{apm_tier_b}', $3::jsonb, true),
                updated_at = now()
          WHERE tenant_id = $1 AND ci_external_id = $2 AND deleted_at IS NULL`,
        [tenantId, ciExternalId, JSON.stringify(block)],
      );
      const rowCount = Array.isArray(res) ? res.length : (res?.[1] ?? 0);
      this.logger.log(`apm_tier_b → ${ciExternalId}: ${seed.signals.map((s) => s.metric).join(', ')} (rows affected: ${rowCount ?? 'n/a'})`);
      seeded.push({ ci: ciExternalId, metrics: seed.signals.map((s) => s.metric) });
    }
    return { seeded };
  }
}
