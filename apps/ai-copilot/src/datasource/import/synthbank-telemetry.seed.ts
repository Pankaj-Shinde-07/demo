import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * SynthBank Tier-A telemetry seed (W6 Phase 2 telemetry-seed v2, ADR-004).
 *
 * Writes golden signals into the SAME self-owned substrate the CMDB spine lives
 * in (per-CI `attributes` jsonb), additively — `synchronize:false`, NO copilot-
 * schema migration. Read back through the portable `DataSourceProvider`
 * telemetry methods (never the substrate directly). This is substrate population,
 * the vertical-data boundary — SynthBank/banking literals legitimately live here
 * (outside the §6.6 engine seam), exactly like the CMDB workbook import.
 *
 * DETERMINISM (T-DETERMINISM): every reading is a pure function of the CI's
 * external id (seeded PRNG) or a frozen constant (the §3 pins). The freshness
 * timestamp is the frozen seed t0 — NO wall-clock, NO Math.random — so a re-seed
 * is byte-identical and APM figures never drift across reruns.
 *
 * §4 preserved DR-gap: one tier-1 service's DR-mirror (Sponsor Bank Link B (DR),
 * CI-0010 — the DR of the sponsor rail carrying atm_card_services and of the gate
 * canary CI) is left WITHOUT telemetry, so APM/CP6.4 surface "DR posture unknown"
 * and never fabricate it.
 */

/** Frozen seed t0 — the single "now" for every reading (deterministic). */
const T0_ISO = '2026-06-09T00:00:00.000Z';
const T0_MS = Date.parse(T0_ISO);
const HOUR_MS = 3_600_000;

/** §4: the DR-mirror left with no telemetry (the preserved honesty gap). */
const DR_GAP_EXTERNAL_IDS = new Set(['CI-0010']);

interface Signal {
  availability_state: 'up' | 'degraded' | 'down';
  cpu_saturation_pct: number | null;
  memory_saturation_pct: number | null;
  primary_saturation_pct: number | null;
  primary_metric: string | null;
  latency_ms: number | null;
  packet_loss_pct: number | null;
  last_reading_at: string;
}

/** §3 pinned story CIs — exact frozen constants that OVERRIDE the generator. */
const PINS: Record<string, Omit<Signal, 'last_reading_at'>> = {
  // #1 CBS primary DB node — the capacity money-shot (conn saturation rising).
  'CI-0002': { availability_state: 'up', cpu_saturation_pct: 72, memory_saturation_pct: 81, primary_saturation_pct: 78, primary_metric: 'connections', latency_ms: null, packet_loss_pct: null },
  // #2 one standard-branch WAN link — branch-local failure (scopes to ~5,000).
  'CI-0093': { availability_state: 'degraded', cpu_saturation_pct: null, memory_saturation_pct: null, primary_saturation_pct: 85, primary_metric: 'bandwidth', latency_ms: 280, packet_loss_pct: 4 },
  // #3 Sponsor Bank Link A — healthy (keeps the gate canary a hypothetical).
  'CI-0005': { availability_state: 'up', cpu_saturation_pct: null, memory_saturation_pct: null, primary_saturation_pct: 22, primary_metric: 'bandwidth', latency_ms: 35, packet_loss_pct: 0.1 },
  // #4 one app server — disk hot (IT-admin "what's hot").
  'CI-0001': { availability_state: 'up', cpu_saturation_pct: 58, memory_saturation_pct: 63, primary_saturation_pct: 88, primary_metric: 'disk', latency_ms: null, packet_loss_pct: null },
  // #5 one CBS↔rail interface CI — elevated but in-band.
  'CI-0027': { availability_state: 'up', cpu_saturation_pct: 31, memory_saturation_pct: 44, primary_saturation_pct: null, primary_metric: null, latency_ms: 95, packet_loss_pct: null },
};

/** §3a shallow recent trend (hourly, last 24h) — deterministic linear ramps. */
const HISTORY: Record<string, { from: Partial<Signal>; to: Partial<Signal> }> = {
  // CBS-DB connection saturation rising ~60% → 78% (the capacity slope).
  'CI-0002': {
    from: { cpu_saturation_pct: 60, memory_saturation_pct: 70, primary_saturation_pct: 60, latency_ms: null },
    to: { cpu_saturation_pct: 72, memory_saturation_pct: 81, primary_saturation_pct: 78, latency_ms: null },
  },
  // App-server disk creeping to 88%.
  'CI-0001': {
    from: { cpu_saturation_pct: 52, memory_saturation_pct: 60, primary_saturation_pct: 70, latency_ms: null },
    to: { cpu_saturation_pct: 58, memory_saturation_pct: 63, primary_saturation_pct: 88, latency_ms: null },
  },
  // Branch link latency degrading toward 280ms.
  'CI-0093': {
    from: { cpu_saturation_pct: null, memory_saturation_pct: null, primary_saturation_pct: 55, latency_ms: 80 },
    to: { cpu_saturation_pct: null, memory_saturation_pct: null, primary_saturation_pct: 85, latency_ms: 280 },
  },
};

export interface TelemetrySeedSummary {
  tenantId: string;
  cisTelemetered: number;
  pinsApplied: string[];
  historySeeded: string[];
  drGapPreserved: string[]; // CIs deliberately left without telemetry
  t0: string;
  deterministic: true;
}

@Injectable()
export class SynthBankTelemetrySeedService {
  private readonly logger = new Logger(SynthBankTelemetrySeedService.name);

  constructor(private readonly db: DataSource) {}

  async seed(tenantId: string): Promise<TelemetrySeedSummary> {
    const cis: Array<{ id: string; ci_external_id: string | null; name: string; ci_type: string }> =
      await this.db.query(
        `SELECT id, ci_external_id, name, ci_type FROM cmdb_configuration_items
          WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY ci_external_id`,
        [tenantId],
      );

    const pinsApplied: string[] = [];
    const historySeeded: string[] = [];
    const drGapPreserved: string[] = [];
    let cisTelemetered = 0;

    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      for (const ci of cis) {
        const ext = ci.ci_external_id ?? '';
        if (DR_GAP_EXTERNAL_IDS.has(ext)) {
          drGapPreserved.push(ext);
          continue; // §4: leave this DR-mirror with NO telemetry, never fabricate it
        }

        const pin = PINS[ext];
        const signal: Signal = pin
          ? { ...pin, last_reading_at: T0_ISO }
          : this.generate(ext, ci.name, ci.ci_type);
        if (pin) pinsApplied.push(ext);

        const merge: Record<string, unknown> = { golden_signal: signal };
        const hist = HISTORY[ext];
        if (hist) {
          merge.golden_signal_history = this.buildHistory(hist.from, hist.to, 24);
          historySeeded.push(ext);
        }

        await runner.query(
          `UPDATE cmdb_configuration_items
              SET attributes = attributes || $3::jsonb, updated_at = now()
            WHERE id = $1 AND tenant_id = $2`,
          [ci.id, tenantId, JSON.stringify(merge)],
        );
        cisTelemetered++;
      }
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }

    // Refresh the provider's capability flag (now hasGoldenSignals=true).
    await this.refreshCapabilities(tenantId);

    return {
      tenantId,
      cisTelemetered,
      pinsApplied: pinsApplied.sort(),
      historySeeded: historySeeded.sort(),
      drGapPreserved,
      t0: T0_ISO,
      deterministic: true,
    };
  }

  /** Deterministic per-CI baseline (§2). Seeded by external id — byte-stable. */
  private generate(ext: string, name: string, ciType: string): Signal {
    const rnd = mulberry32(hashString(ext || name));
    const pick = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const isDrMirror = /\(DR\)/i.test(name) || ciType === 'dr_site_node';
    const cat = categoryOf(ciType);

    // DR-mirror standby nodes idle low (§2 "DR-mirror nodes: low low up").
    const scale = isDrMirror ? 0.35 : 1;
    const sat = (lo: number, hi: number) => Math.round(pick(lo, hi) * scale);

    const base: Signal = {
      availability_state: 'up',
      cpu_saturation_pct: null,
      memory_saturation_pct: null,
      primary_saturation_pct: null,
      primary_metric: null,
      latency_ms: null,
      packet_loss_pct: null,
      last_reading_at: T0_ISO,
    };

    switch (cat) {
      case 'db':
        return { ...base, cpu_saturation_pct: sat(30, 50), memory_saturation_pct: sat(50, 70), primary_saturation_pct: sat(35, 60), primary_metric: 'connections' };
      case 'app':
        return { ...base, cpu_saturation_pct: sat(25, 55), memory_saturation_pct: sat(40, 65), primary_saturation_pct: sat(30, 60), primary_metric: 'disk' };
      case 'firewall':
        return { ...base, cpu_saturation_pct: sat(20, 45), memory_saturation_pct: sat(30, 55) };
      case 'network':
        return { ...base, cpu_saturation_pct: sat(15, 40), memory_saturation_pct: sat(30, 55), latency_ms: pick(1, 10) };
      case 'link':
        return { ...base, primary_saturation_pct: sat(20, 55), primary_metric: 'bandwidth', latency_ms: pick(20, 80), packet_loss_pct: Math.round(pick(0, 5) * 0.1 * 10) / 10 };
      case 'interface':
        return { ...base, cpu_saturation_pct: sat(15, 35), memory_saturation_pct: sat(25, 45), latency_ms: pick(5, 40) };
      case 'endpoint':
      default:
        return { ...base, latency_ms: pick(1, 15) };
    }
  }

  /** Build a deterministic hourly ramp ending at the frozen t0. */
  private buildHistory(
    from: Partial<Signal>,
    to: Partial<Signal>,
    points: number,
  ): Array<Record<string, unknown>> {
    const lerp = (a: number | null | undefined, b: number | null | undefined, t: number) =>
      a === null || a === undefined || b === null || b === undefined
        ? null
        : Math.round((a + (b - a) * t) * 10) / 10;
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < points; i++) {
      const t = points === 1 ? 1 : i / (points - 1);
      const at = new Date(T0_MS - (points - 1 - i) * HOUR_MS).toISOString();
      out.push({
        at,
        cpu_saturation_pct: lerp(from.cpu_saturation_pct, to.cpu_saturation_pct, t),
        memory_saturation_pct: lerp(from.memory_saturation_pct, to.memory_saturation_pct, t),
        primary_saturation_pct: lerp(from.primary_saturation_pct, to.primary_saturation_pct, t),
        latency_ms: lerp(from.latency_ms, to.latency_ms, t),
      });
    }
    return out;
  }

  private async refreshCapabilities(tenantId: string): Promise<void> {
    const [row] = await this.db.query(
      `SELECT
         (SELECT count(*) FROM cmdb_configuration_items WHERE tenant_id = $1 AND deleted_at IS NULL) AS cis,
         (SELECT count(*) FROM cmdb_relationships     WHERE tenant_id = $1) AS rels,
         (SELECT count(*) FROM cmdb_business_services WHERE tenant_id = $1 AND deleted_at IS NULL) AS svcs,
         (SELECT count(*) FROM cmdb_change_links      WHERE tenant_id = $1) AS changes,
         (SELECT count(*) FROM cmdb_configuration_items WHERE tenant_id = $1 AND deleted_at IS NULL AND (technical_owner_id IS NOT NULL OR business_owner_id IS NOT NULL)) AS owned,
         (SELECT count(*) FROM cmdb_configuration_items WHERE tenant_id = $1 AND deleted_at IS NULL AND criticality_tier <> 'unknown') AS tiered,
         (SELECT count(*) FROM cmdb_configuration_items WHERE tenant_id = $1 AND deleted_at IS NULL AND attributes ? 'golden_signal') AS telemetered`,
      [tenantId],
    );
    const caps = {
      hasConfigurationItems: Number(row.cis) > 0,
      hasRelationshipGraph: Number(row.rels) > 0,
      hasBusinessServices: Number(row.svcs) > 0,
      hasChangeLinkage: Number(row.changes) > 0,
      hasOwnership: Number(row.owned) > 0,
      hasCriticality: Number(row.tiered) > 0,
      hasGoldenSignals: Number(row.telemetered) > 0,
    };
    await this.db.query(
      `UPDATE tenant_data_sources SET cmdb_capabilities = $2::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND provider_name = 'canaris_ems'`,
      [tenantId, JSON.stringify(caps)],
    );
  }
}

// ── deterministic PRNG helpers (no Math.random / wall-clock in values) ─────────

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Category = 'db' | 'app' | 'firewall' | 'network' | 'link' | 'interface' | 'endpoint';

function categoryOf(ciType: string): Category {
  switch (ciType) {
    case 'cbs_database_server':
      return 'db';
    case 'cbs_application_server':
    case 'internet_banking_server':
    case 'mobile_banking_gateway':
    case 'recon_server':
    case 'server':
    case 'cbs_hosted_service':
      return 'app';
    case 'firewall':
      return 'firewall';
    case 'branch_switch':
    case 'hub_router':
    case 'hub_switch':
    case 'core_switch':
    case 'core_router':
    case 'atm_switch':
    case 'upi_switch':
      return 'network';
    case 'branch_router':
    case 'sponsor_bank_link':
    case 'npci_link':
      return 'link';
    case 'cts_system':
    case 'payment_gateway':
    case 'hsm_device':
    case 'ad_dns_dhcp':
    case 'backup_system':
    case 'dr_site_node':
      return 'interface';
    case 'atm_terminal':
    default:
      return 'endpoint';
  }
}
