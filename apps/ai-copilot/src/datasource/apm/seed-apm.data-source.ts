import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ApmSource } from './apm-source.interface';
import type { ApmCapabilities, ApmSignalReading, ServicePerformance } from '../data-source.types';

/**
 * ADR-006 seed-mode APM source. Reads the labeled-synthetic Tier-B signals from
 * the self-owned substrate (`attributes->'apm_tier_b'` on a CI, mirroring the
 * Tier-A `golden_signal` key) — real now, synthetic-labeled. Point-in-time only:
 * no percentiles, no time-series. A ref with no seeded Tier-B → honest 'absent'.
 */
@Injectable()
export class SeedApmDataSource implements ApmSource {
  readonly mode = 'seed' as const;
  private readonly logger = new Logger(SeedApmDataSource.name);

  constructor(private readonly db: DataSource) {}

  async apmCapabilities(): Promise<ApmCapabilities> {
    // Seed substrate carries app-latency/query-time/success-rate/availability;
    // percentiles + traces are NOT produced by point-in-time readings.
    return {
      mode: 'seed',
      hasResponseTime: true,
      hasQueryTime: true,
      hasSuccessRate: true,
      hasErrorRate: false,
      hasAppAvailability: true,
      hasPercentiles: false,
      hasTraces: false,
    };
  }

  async getServicePerformance(ref: string, tenantId: string): Promise<ServicePerformance> {
    // 1) ref as a CI (external id or name) carrying apm_tier_b.
    const [ciRow] = await this.db.query(
      `SELECT ci_external_id, name, attributes->'apm_tier_b' AS apm
         FROM cmdb_configuration_items
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND (ci_external_id = $2 OR name = $2)
          AND attributes ? 'apm_tier_b'
        LIMIT 1`,
      [tenantId, ref],
    );
    if (ciRow?.apm) {
      return this.present(ref, ciRow.name as string, 'ci',
        this.mapSignals(ciRow.apm as ApmBlock, ciRow.ci_external_id as string, ciRow.name as string));
    }

    // 2) ref as a service → member CIs carrying apm_tier_b (e.g. upi_imps → CI-0004).
    const [svc] = await this.db.query(
      `SELECT id, name FROM cmdb_business_services
        WHERE tenant_id = $1 AND deleted_at IS NULL AND name = $2 LIMIT 1`,
      [tenantId, ref],
    );
    if (svc) {
      const rows = await this.db.query(
        `SELECT c.ci_external_id, c.name, c.attributes->'apm_tier_b' AS apm
           FROM cmdb_configuration_items c
           JOIN cmdb_service_ci_links l ON l.ci_id = c.id AND l.tenant_id = c.tenant_id
          WHERE l.service_id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL
            AND c.attributes ? 'apm_tier_b'`,
        [svc.id, tenantId],
      );
      const signals = (rows as ApmRow[]).flatMap((r) => this.mapSignals(r.apm, r.ci_external_id, r.name));
      if (signals.length > 0) return this.present(ref, svc.name as string, 'service', signals);
    }

    return this.absent(ref);
  }

  private mapSignals(apm: ApmBlock, ciExternalId: string, ciName: string): ApmSignalReading[] {
    const synthetic = apm.synthetic ? 'SynthBank synthetic data' : null;
    return (apm.signals ?? []).map((s) => ({
      metric: s.metric,
      value: s.value,
      unit: s.unit,
      baseline: s.baseline ?? null,
      multipleOfBaseline: s.unit === 'ms' && s.baseline ? Number((s.value / s.baseline).toFixed(2)) : null,
      readingAt: apm.reading_at,
      syntheticLabel: synthetic,
      ciExternalId,
      ciName,
    }));
  }

  private present(ref: string, name: string, kind: 'ci' | 'service', signals: ApmSignalReading[]): ServicePerformance {
    return {
      ref, name, kind,
      completeness: 'present',
      signals,
      percentilesAvailable: false,
      note: 'percentiles unavailable — point-in-time reading',
      source: { provider: 'canaris_ems_seed', mode: 'seed' },
    };
  }

  private absent(ref: string): ServicePerformance {
    return {
      ref, name: null, kind: 'ci',
      completeness: 'absent',
      signals: [],
      percentilesAvailable: false,
      note: 'no Tier-B (app-layer) signals seeded for this entity',
      source: { provider: 'canaris_ems_seed', mode: 'seed' },
    };
  }
}

interface ApmBlock {
  synthetic?: boolean;
  reading_at: string;
  signals: Array<{ metric: ApmSignalReading['metric']; value: number; unit: ApmSignalReading['unit']; baseline?: number }>;
}
interface ApmRow { ci_external_id: string; name: string; apm: ApmBlock }
