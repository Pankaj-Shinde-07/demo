import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * SynthBank §FROZEN profile seed (W6 Phase 2, T-SPINE-DATA completion).
 *
 * Writes the architect-frozen SynthBank business profile into the spine as
 * ACTUAL DATA, so the Context Engine MEASURES it (Class-1) by traversal rather
 * than assuming it. This is substrate population — the same layer as the CMDB
 * workbook import (CmdbImportService) and ADR-002's "seed goes through the
 * datasource layer" rule. It is NOT engine/reasoning code, so SynthBank/banking
 * literals legitimately live here (outside the §6.6 portability seam, which
 * scans the reasoning engine, not the substrate ingestion layer).
 *
 * Frozen profile (the single source of truth — see W6-phase2-brief §FROZEN):
 *   - 50 branches, modelled as the 50 `branch_router` CIs (BR-001..BR-050).
 *   - 10 urban @ 25,000 customers (BR-001..BR-010)  = 250,000
 *   - 40 standard @ 5,000 customers (BR-011..BR-050) = 200,000
 *   - TOTAL = 450,000 active customers (sums exactly; per-branch real spine data).
 *   - Every branch DEPENDS ON the tier-1 customer-facing service set
 *     (UPI/IMPS, ATM/card, internet/mobile banking, NEFT/RTGS, CBS), wired via
 *     cmdb_service_ci_links role='dependency' so a tier-1 rail degradation
 *     traverses to the full affected customer base.
 *
 * Re-running is safe and additive: customer counts are merged into the existing
 * `attributes` jsonb (overwrite-with-same-value = idempotent), and links use
 * ON CONFLICT DO NOTHING. No schema change, no new table (§6.10).
 */

/** The tier-1 customer-facing service set every branch depends on (§FROZEN). */
const TIER1_CUSTOMER_FACING_SERVICES = [
  'upi_imps',
  'atm_card_services',
  'internet_mobile_banking',
  'neft_rtgs',
  'core_banking',
] as const;

const URBAN_BRANCH_COUNT = 10;
const URBAN_CUSTOMERS = 25_000;
const STANDARD_CUSTOMERS = 5_000;
const BRANCH_CI_TYPE = 'branch_router';

export interface SynthBankProfileSummary {
  tenantId: string;
  branchesTotal: number;
  urbanBranches: number;
  standardBranches: number;
  totalCustomers: number;
  serviceLinksEnsured: number;
  missingServices: string[];
  unparsedBranches: string[];
  reconciles: boolean; // totalCustomers === 450,000 AND branchesTotal === 50
}

@Injectable()
export class SynthBankProfileSeedService {
  private readonly logger = new Logger(SynthBankProfileSeedService.name);

  constructor(private readonly db: DataSource) {}

  async seed(tenantId: string): Promise<SynthBankProfileSummary> {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const unparsedBranches: string[] = [];
    let urbanBranches = 0;
    let standardBranches = 0;
    let totalCustomers = 0;
    let serviceLinksEnsured = 0;

    try {
      // 1) Resolve the tier-1 customer-facing service ids (warn on any missing).
      const svcRows: Array<{ id: string; name: string }> = await runner.query(
        `SELECT id, name FROM cmdb_business_services
          WHERE tenant_id = $1 AND deleted_at IS NULL AND name = ANY($2::text[])`,
        [tenantId, [...TIER1_CUSTOMER_FACING_SERVICES]],
      );
      const serviceIdByName = new Map(svcRows.map((r) => [r.name, r.id]));
      const missingServices = TIER1_CUSTOMER_FACING_SERVICES.filter(
        (n) => !serviceIdByName.has(n),
      );
      if (missingServices.length) {
        this.logger.warn(
          `tier-1 customer-facing services missing for tenant ${tenantId}: ${missingServices.join(', ')}`,
        );
      }

      // 2) Branch CIs (the 50 branch_router nodes — the canonical branch entity).
      const branches: Array<{ id: string; name: string }> = await runner.query(
        `SELECT id, name FROM cmdb_configuration_items
          WHERE tenant_id = $1 AND ci_type = $2 AND deleted_at IS NULL
          ORDER BY name`,
        [tenantId, BRANCH_CI_TYPE],
      );

      for (const b of branches) {
        const num = this.branchNumber(b.name);
        if (num === null) {
          unparsedBranches.push(b.name);
          continue;
        }
        const isUrban = num <= URBAN_BRANCH_COUNT;
        const customerCount = isUrban ? URBAN_CUSTOMERS : STANDARD_CUSTOMERS;
        const branchType = isUrban ? 'urban' : 'standard';
        if (isUrban) urbanBranches++;
        else standardBranches++;
        totalCustomers += customerCount;

        // Merge the frozen counts into the existing attributes jsonb (idempotent).
        await runner.query(
          `UPDATE cmdb_configuration_items
              SET attributes = attributes || $3::jsonb, updated_at = now()
            WHERE id = $1 AND tenant_id = $2`,
          [
            b.id,
            tenantId,
            JSON.stringify({ customer_count: customerCount, branch_type: branchType }),
          ],
        );

        // Wire branch -> each tier-1 customer-facing service (role='dependency').
        for (const svcName of TIER1_CUSTOMER_FACING_SERVICES) {
          const serviceId = serviceIdByName.get(svcName);
          if (!serviceId) continue;
          await runner.query(
            `INSERT INTO cmdb_service_ci_links (tenant_id, service_id, ci_id, role)
             VALUES ($1, $2, $3, 'dependency')
             ON CONFLICT (service_id, ci_id, COALESCE(role, '')) DO NOTHING`,
            [tenantId, serviceId, b.id],
          );
          serviceLinksEnsured++;
        }
      }

      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }

    const branchesTotal = urbanBranches + standardBranches;
    const reconciles = totalCustomers === 450_000 && branchesTotal === 50;
    // Surface any missing tier-1 service via a fresh read-only check, so the
    // summary is accurate on a re-run too.
    const present: Array<{ name: string }> = await this.db.query(
      `SELECT name FROM cmdb_business_services
        WHERE tenant_id = $1 AND deleted_at IS NULL AND name = ANY($2::text[])`,
      [tenantId, [...TIER1_CUSTOMER_FACING_SERVICES]],
    );
    const presentNames = new Set(present.map((r) => r.name));
    const missing = TIER1_CUSTOMER_FACING_SERVICES.filter((n) => !presentNames.has(n));

    return {
      tenantId,
      branchesTotal,
      urbanBranches,
      standardBranches,
      totalCustomers,
      serviceLinksEnsured,
      missingServices: missing,
      unparsedBranches,
      reconciles,
    };
  }

  /** Parse the BR-NNN ordinal from a branch CI name ('Branch Router BR-014' → 14). */
  private branchNumber(name: string): number | null {
    const m = name.match(/BR-(\d+)/i);
    return m ? Number(m[1]) : null;
  }
}
