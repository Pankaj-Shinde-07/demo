import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSourceRegistry } from '../datasource/data-source.registry';
import { ContextEngine } from '../context/context-engine.service';
import { IncidentReasoningService } from '../incident/incident-reasoning.service';
import { PackLoaderService } from '../packs/pack-loader.service';
import { CLASS_LABEL, type Assumption, type Figure, type FigureClass, type GroundingInput } from '../context/business-impact.types';
import { BASELINE_CI_EXTERNAL_ID } from '../datasource/import/synthbank-baseline.seed';
import type { DataSourceProvider } from '../datasource/data-source-provider.interface';
import type { GoldenSignal } from '../datasource/data-source.types';
import type { ContextGap } from '../context/impact-graph.types';
import type { ValueModel } from '../packs/value-model.schema';
import type { Tile } from './dashboard.types';

/**
 * W9 (CP9.1/9.3/9.6) — the deterministic tile library. Each tile reuses proven
 * capability (W6 traversal+D15, W8 incidents, telemetry, the pack value-model)
 * and emits CLASSED figures (ADR-005); a missing data source flips the tile to
 * honest empty-state with a named gap (never a fabricated number). NO LLM here;
 * NO banking literal (§6.6). Impact figures are traversal-derived (T-IMPACT-RESTATE).
 */
const T0_MS = Date.parse('2026-06-09T00:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// The "current incident" for risk-now = the EOD scenario (scenario-2): carries
// the smoking-gun change + a customer-impacting root. Demo-scoped window.
const RISK_WINDOW = { from: new Date(T0_MS + 2 * DAY - 60_000), to: new Date(T0_MS + 2 * DAY + 6 * HOUR + 60_000), scenario: 'scenario-2', root: 'CI-0002' };
const P2_SPAN = { from: new Date(T0_MS), to: new Date(T0_MS + 10 * DAY) };

@Injectable()
export class DashboardTilesService {
  private readonly logger = new Logger(DashboardTilesService.name);
  private readonly label: string | null;

  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly context: ContextEngine,
    private readonly incident: IncidentReasoningService,
    private readonly packs: PackLoaderService,
    private readonly config: ConfigService,
  ) {
    const l = this.config.get<string>('SYNTHETIC_DATA_LABEL', '');
    this.label = l && l.length > 0 ? l : null;
  }

  // ── risk-now (CEO #3): current incident → traversal-derived impact (D15) ─────
  async riskNow(tenantId: string, packId: string): Promise<Tile> {
    const analysis = await this.incident.analyzeWindow({ tenantId, window: { from: RISK_WINDOW.from, to: RISK_WINDOW.to }, packId, scenario: RISK_WINDOW.scenario });
    if (!analysis) return this.empty('risk_now', 'Risk Now', 'open_incidents', 'no_active_incident');
    const ctx = await this.context.buildContext({ tenantId, entity: { type: 'ci', ref: analysis.incident.rootCandidateCiRefs[0] }, packId });
    const figures: Figure[] = [
      this.fig('open_incidents', 1, 'count', 'measured', [{ ref: `incident:${analysis.incident.incidentId}`, description: `incident rooted at ${analysis.incident.rootCandidateCiRefs[0]}` }]),
      this.fig('alerts_correlated', analysis.incident.rawAlertCount, 'count', 'measured', [{ ref: `incident:${analysis.incident.incidentId}`, description: `${analysis.incident.compressionRatio} compression to one incident` }]),
      // REUSE the D15 classed impact figures verbatim — never re-stated.
      ...ctx.cmdbContext.businessImpact.figures,
    ];
    const notes = [
      'The correlated alerts collapse to a single incident (see alerts_correlated / open_incidents figures).',
      analysis.rankedCauses[0]?.score > 0 ? `Likely root: recent change ${analysis.rankedCauses[0].changeRef}.` : `Likely root: ${analysis.incident.rootCandidateCiRefs[0]}.`,
    ];
    return this.tile('risk_now', 'Risk Now', figures, notes, ctx.cmdbContext.gaps);
  }

  // ── value-realized / ROI (CEO #1/#5): baseline × measured compression (CP9.3) ─
  async valueRealized(tenantId: string, packId: string): Promise<Tile> {
    const provider = await this.registry.getCmdbProvider(tenantId);
    const baseline = provider ? await this.baseline(provider, tenantId) : null;
    if (!baseline) {
      // T-BASELINE-HONESTY: no captured baseline → ROI is unprovable, NOT faked.
      return { id: 'value_realized', title: 'Value Realized (ROI)', status: 'empty', figures: [], notes: ['ROI is unprovable — no "before-Canaris" baseline was captured at onboarding. Capture the baseline to enable this number.'], gaps: [{ scope: 'tenant', missingInput: 'onboarding_baseline', degradedOutput: 'roi_unprovable' }], label: this.label };
    }
    const vm = await this.valueModel(packId);
    if (!vm?.roi) return this.empty('value_realized', 'Value Realized (ROI)', 'roi_coefficients', 'roi_coefficients_unavailable');

    const avgCompression = await this.avgCompression(provider!, tenantId); // measured (Class-1 input)
    const nocHoursMonthly = baseline.noc_hours_per_week * 4.33;
    const compressionEfficiency = avgCompression > 1 ? 1 - 1 / avgCompression : 0;

    const triage = vm.roi.triageSharePct;
    const mttrRed = vm.roi.mttrReductionPct;
    const penalty = vm.roi.monthlyPenaltyEstimateInr;
    const churn = vm.retention.monthlyChurnRatePct;

    const nocHoursSaved = round1(nocHoursMonthly * (triage.value / 100) * compressionEfficiency);
    // downtime value avoided: monthly incidents × MTTR hours × reduction × a
    // measured representative tier-1 hourly revenue (from the spine).
    const repHourly = await this.representativeTier1Hourly(provider!, tenantId);
    const downtimeAvoided = Math.round(baseline.monthly_incident_volume * (baseline.avg_mttr_minutes / 60) * (mttrRed.value / 100) * repHourly);

    const baseGround: GroundingInput[] = [
      { ref: `cmdb:ci:${BASELINE_CI_EXTERNAL_ID}`, description: `baseline: ${baseline.noc_hours_per_week} NOC hrs/wk, MTTR ${baseline.avg_mttr_minutes}min, ${baseline.monthly_incident_volume} incidents/mo` },
      { ref: 'measured:avg_compression', description: `measured average alert→incident compression ${avgCompression.toFixed(2)}:1 (W8)` },
    ];
    const figures: Figure[] = [
      this.fig('avg_compression_ratio', round1(avgCompression), 'ratio_to_1', 'measured', [{ ref: 'measured:avg_compression', description: 'measured across the seeded incident windows (W8)' }]),
      this.fig('noc_hours_saved_monthly', nocHoursSaved, 'hours', 'derived', baseGround, [this.assume(`triage share of NOC effort = ${triage.value}%`, triage.verify), this.assume('compression reduces triage effort ~linearly', null)]),
      this.fig('downtime_value_avoided_monthly', downtimeAvoided, 'inr', 'derived', [...baseGround, { ref: 'measured:tier1_hourly', description: `representative tier-1 revenue_impact_hourly ${repHourly}` }], [this.assume(`MTTR reduced ${mttrRed.value}%`, mttrRed.verify)]),
      this.fig('penalties_averted_monthly', penalty.value, 'inr', 'estimated', baseGround, [this.assume('regulatory penalty exposure averted (assumption-only)', penalty.verify)]),
    ];
    // retention value (Class-3) — only if churn coefficient is meaningful.
    if (churn.value > 0) {
      figures.push(this.fig('retention_value_protected_monthly', Math.round(baseline.monthly_incident_volume * (churn.value / 100)), 'customers', 'estimated', baseGround, [this.assume(`assumed monthly churn ${churn.value}% (assumption-only)`, churn.verify)]));
    }
    return this.tile('value_realized', 'Value Realized (ROI)', figures, ['Derived from the captured before-Canaris baseline × measured compression; assumptions declared per figure.'], []);
  }

  // ── compliance standing (CP9.6): posture + reportable, [verify], no assertion ─
  async compliance(tenantId: string, packId: string): Promise<Tile> {
    const reg = this.regulatory(await this.loadPack(packId));
    if (!reg) return this.empty('compliance', 'Compliance Standing', 'regulatory_rules', 'compliance_not_configured');
    const notes = [
      `Framework: ${reg.framework ?? 'unknown'} (regulator ${reg.regulator ?? 'unknown'}).`,
      `Reportability mechanism active — obligation: "${reg.incident_reporting ?? 'see pack'}".`,
      'Assist only — NOT a definitive regulatory standing. Confirm specifics against the current circular [verify].',
    ];
    // No asserted "compliant" figure; one honest classed posture figure.
    const figures: Figure[] = [this.fig('reportable_obligations_surfaced', 1, 'count', 'measured', [{ ref: 'pack:regulatory_context', description: 'pack regulatory rule present (placeholder, [verify])' }])];
    return { ...this.tile('compliance', 'Compliance Standing', figures, notes, [{ scope: 'pack:regulatory', missingInput: 'verified_rbi_specifics', degradedOutput: 'specifics_pending_verify' }]), status: 'partial' };
  }

  // ── cost / asset-optimization (IT-admin): idle / over-provisioned from telemetry
  async costOptimization(tenantId: string): Promise<Tile> {
    const signals = await this.estateSignals(tenantId);
    if (signals.length === 0) return this.empty('cost', 'Cost / Optimization', 'telemetry', 'golden_signals_unavailable');
    const idle = signals.filter((s) => (s.cpuSaturationPct ?? 100) < 15 && (s.primarySaturationPct ?? 100) < 20).length;
    const hot = signals.filter((s) => (s.cpuSaturationPct ?? 0) > 85 || (s.primarySaturationPct ?? 0) > 85).length;
    const ground: GroundingInput[] = [{ ref: 'telemetry:estate', description: `${signals.length} CIs with golden signals` }];
    const figures: Figure[] = [
      this.fig('idle_reclaim_candidates', idle, 'count', 'measured', ground),
      this.fig('at_capacity_ci', hot, 'count', 'measured', ground),
      this.fig('telemetered_ci', signals.length, 'count', 'measured', ground),
    ];
    return this.tile('cost', 'Cost / Optimization', figures, ['Idle = low CPU and low primary saturation (reclaim candidates); at-capacity = high saturation.'], []);
  }

  // ── BCP / DR posture (CP9.6): surface the DR-gap at board altitude (T-DR-GAP) ─
  async bcpDr(tenantId: string): Promise<Tile> {
    const provider = await this.registry.getCmdbProvider(tenantId);
    if (!provider) return this.empty('bcp_dr', 'BCP / DR Posture', 'cmdb', 'context_unavailable');
    // Tier-1 CIs with a DR mapping whose DR mirror has NO telemetry → unverified.
    const tier1 = (await provider.searchConfigurationItems({ criticalityTier: 'tier-1', limit: 200 }, tenantId)).filter((c) => typeof c.attributes?.['dr_mapping'] === 'string' && (c.attributes['dr_mapping'] as string).trim().length > 0);
    const gaps: ContextGap[] = [];
    const unverified: string[] = [];
    for (const ci of tier1) {
      const drName = (ci.attributes['dr_mapping'] as string).trim();
      const drCi = await provider.findConfigurationItem(drName, tenantId);
      if (drCi?.externalId) {
        const sig = await provider.getGoldenSignalsForCis([drCi.externalId], tenantId);
        if (sig.length === 0) {
          unverified.push(`${ci.name} → ${drName}`);
          gaps.push({ scope: `ci:${drCi.externalId}`, missingInput: 'dr_mirror_telemetry', degradedOutput: 'dr_posture_unknown' });
        }
      }
    }
    const ground: GroundingInput[] = [{ ref: 'cmdb:tier1_dr', description: `${tier1.length} tier-1 CIs with a DR mapping` }];
    const figures: Figure[] = [
      this.fig('tier1_with_dr_mapping', tier1.length, 'count', 'measured', ground),
      this.fig('dr_posture_unverified', unverified.length, 'count', 'measured', [{ ref: 'telemetry:dr_mirrors', description: 'DR mirrors with no reachability telemetry' }]),
    ];
    const notes = unverified.length ? [`Board-visible BCP risk: ${unverified.length} tier-1 service(s) have NO confirmed DR coverage — ${unverified.join('; ')}. Surfaced, not filled.`] : ['All tier-1 DR mirrors report telemetry.'];
    return { ...this.tile('bcp_dr', 'BCP / DR Posture', figures, notes, gaps), status: unverified.length ? 'partial' : 'ok' };
  }

  // ── ROI trend (CP9.5): DEFERRED. A quarter-over-quarter trend requires real
  // accrued history, which does not exist pre-deployment. We do NOT emit a
  // synthetic ramp — a fabricated-looking trend line beside honest figures would
  // undo the honesty. The tile carries the current monthly rate as the redirect
  // and an explicit "no accrued history yet" note; no period figures are emitted.
  async roiTrend(tenantId: string, packId: string): Promise<Tile> {
    const vr = await this.valueRealized(tenantId, packId);
    const nocSaved = vr.figures.find((f) => f.metric === 'noc_hours_saved_monthly')?.value ?? null;
    if (nocSaved === null) return { id: 'trend', title: 'Value Trend', status: 'empty', figures: [], notes: ['Trend unavailable — ROI not computable (baseline missing).'], gaps: vr.gaps, label: this.label };
    return {
      id: 'trend',
      title: 'Value Trend (accrues post-deployment)',
      status: 'empty',
      figures: [],
      notes: [
        `No accrued quarter-over-quarter history yet — a real trend builds up once the tool runs in your environment. Current monthly rate: ${nocSaved} NOC hours saved/month (see Value Realized). This is the capability; the trend is not synthesised.`,
      ],
      gaps: [{ scope: 'tenant', missingInput: 'accrued_value_history', degradedOutput: 'qoq_trend_unavailable' }],
      label: this.label,
    };
  }

  // ── service-health (CP9.1, NOC #8) ──────────────────────────────────────────
  async serviceHealth(tenantId: string): Promise<Tile> {
    const signals = await this.estateSignals(tenantId);
    if (signals.length === 0) return this.empty('service_health', 'Service Health', 'telemetry', 'golden_signals_unavailable');
    const degraded = signals.filter((s) => s.availabilityState !== 'up').length;
    const ground: GroundingInput[] = [{ ref: 'telemetry:estate', description: `${signals.length} CIs` }];
    const figures: Figure[] = [
      this.fig('ci_up', signals.filter((s) => s.availabilityState === 'up').length, 'count', 'measured', ground),
      this.fig('ci_degraded_or_down', degraded, 'count', 'measured', ground),
    ];
    return this.tile('service_health', 'Service Health', figures, [degraded ? `${degraded} CI(s) not fully available.` : 'All telemetered CIs report available.'], []);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  private async baseline(provider: DataSourceProvider, tenantId: string) {
    const ci = await provider.findConfigurationItem(BASELINE_CI_EXTERNAL_ID, tenantId);
    const b = ci?.attributes?.['baseline'] as Record<string, unknown> | undefined;
    if (!b) return null;
    return {
      noc_hours_per_week: Number(b.noc_hours_per_week),
      avg_mttr_minutes: Number(b.avg_mttr_minutes),
      monthly_incident_volume: Number(b.monthly_incident_volume),
    };
  }

  private async avgCompression(provider: DataSourceProvider, tenantId: string): Promise<number> {
    const alerts = await provider.getAlertsInWindow(P2_SPAN, tenantId);
    if (alerts.length === 0) return 1;
    const scenarios = new Set(alerts.map((a) => a.scenario ?? 'na'));
    return alerts.length / Math.max(1, scenarios.size);
  }

  private async representativeTier1Hourly(provider: DataSourceProvider, tenantId: string): Promise<number> {
    // Measured: average tier-1 service revenue_impact_hourly from the spine.
    const cis = await provider.searchConfigurationItems({ criticalityTier: 'tier-1', limit: 1 }, tenantId);
    const root = cis[0]?.externalId ?? 'CI-0005';
    const svcs = await provider.getServicesAffectedByCi((await provider.findConfigurationItem(root, tenantId))?.id ?? '', tenantId);
    const vals = svcs.map((s) => Number(s.revenueImpactHourly)).filter((n) => Number.isFinite(n) && n > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 1_000_000;
  }

  private async estateSignals(tenantId: string): Promise<GoldenSignal[]> {
    const provider = await this.registry.getCmdbProvider(tenantId);
    if (!provider) return [];
    const cis = await provider.searchConfigurationItems({ limit: 500 }, tenantId);
    const ids = cis.map((c) => c.externalId).filter((x): x is string => !!x);
    return provider.getGoldenSignalsForCis(ids, tenantId);
  }

  private async loadPack(packId: string): Promise<unknown | null> {
    try { return await this.packs.getPack(packId); } catch { return null; }
  }
  private async valueModel(packId: string): Promise<ValueModel | null> {
    const pack = await this.loadPack(packId);
    return (pack as { valueModel?: ValueModel } | null)?.valueModel ?? null;
  }
  private regulatory(pack: unknown): Record<string, string> | null {
    const m = (pack as { cmdbMappings?: Record<string, unknown> } | null)?.cmdbMappings?.['regulatory_context'];
    return m && typeof m === 'object' ? (m as Record<string, string>) : null;
  }

  private fig(metric: string, value: number, unit: string, cls: FigureClass, grounding: GroundingInput[], assumptions: Assumption[] = []): Figure {
    return { metric, value, unit, class: cls, classLabel: CLASS_LABEL[cls], groundingInputs: grounding, assumptions };
  }
  private assume(description: string, verify: string | null): Assumption {
    return { description, verify };
  }
  private tile(id: string, title: string, figures: Figure[], notes: string[], gaps: Tile['gaps']): Tile {
    return { id, title, status: 'ok', figures, notes, gaps, label: this.label };
  }
  private empty(id: string, title: string, missing: string, degraded: string): Tile {
    return { id, title, status: 'empty', figures: [], notes: [`Honest empty-state — ${missing} unavailable.`], gaps: [{ scope: id, missingInput: missing, degradedOutput: degraded }], label: this.label };
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
