import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * SynthBank §FROZEN "before-Canaris" baseline seed (W9 CP9.2 — the ROI dependency).
 *
 * ROI (CEO #1/#5) is unprovable without a baseline captured at onboarding. For
 * the demo, SynthBank gets a FROZEN synthetic baseline — a genuine measurement
 * OF SynthBank (Class-1-of-SynthBank, labelled synthetic). It rides the substrate
 * additively as an ISOLATED CI (`ci_type=org_baseline`, no links → no traversal
 * pollution), so NO copilot-schema migration is needed. A real client whose
 * baseline was not captured simply has no such CI → ROI degrades honestly to
 * "unprovable" (T-BASELINE-HONESTY). Single source of truth (W9-brief §FROZEN);
 * [ucb-verify] — field figures replace these.
 */

export const BASELINE_CI_EXTERNAL_ID = 'BASELINE-0001';

/** The frozen §FROZEN baseline values (single source of truth). */
export const FROZEN_BASELINE = {
  noc_hours_per_week: 45,
  avg_mttr_minutes: 240,
  monthly_incident_volume: 120,
  existing_monitoring: 'partial',
  label: 'SynthBank synthetic data',
  verify: '[ucb-verify] field baseline replaces these when captured at onboarding',
} as const;

export interface BaselineSeedSummary {
  tenantId: string;
  baselineCiExternalId: string;
  baseline: typeof FROZEN_BASELINE;
  seeded: boolean;
}

@Injectable()
export class SynthBankBaselineSeedService {
  private readonly logger = new Logger(SynthBankBaselineSeedService.name);

  constructor(private readonly db: DataSource) {}

  async seed(tenantId: string): Promise<BaselineSeedSummary> {
    const attributes = { baseline: FROZEN_BASELINE };
    await this.db.query(
      `INSERT INTO cmdb_configuration_items
         (tenant_id, ci_external_id, ci_type, name, criticality_tier, attributes, source)
       VALUES ($1, $2, 'org_baseline', $3, 'unknown', $4::jsonb, 'canaris_ems')
       ON CONFLICT (tenant_id, source, ci_external_id)
         WHERE ci_external_id IS NOT NULL AND deleted_at IS NULL
       DO UPDATE SET attributes = EXCLUDED.attributes, name = EXCLUDED.name, updated_at = now()`,
      [tenantId, BASELINE_CI_EXTERNAL_ID, 'SynthBank Before-Canaris Baseline (synthetic)', JSON.stringify(attributes)],
    );
    return { tenantId, baselineCiExternalId: BASELINE_CI_EXTERNAL_ID, baseline: FROZEN_BASELINE, seeded: true };
  }
}
