import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSourceRegistry } from '../datasource/data-source.registry';
import { CmdbGraphService } from '../context/cmdb-graph.service';
import { PackLoaderService } from '../packs/pack-loader.service';
import type { DataSourceProvider } from '../datasource/data-source-provider.interface';
import type { AlertRecord, ChangeEvent, ConfigurationItem } from '../datasource/data-source.types';
import {
  buildTimeline,
  classifyBranchFailure,
  computeConfidence,
  rankRootCauses,
  recommendAction,
} from './incident-analysis';
import { assessReportability } from './reportability';
import type {
  AnalyzeWindowInput,
  ContextGapRef,
  Incident,
  IncidentAnalysis,
  IncidentImpact,
  RankedCause,
} from './incident.types';

/**
 * W8 — the DETERMINISTIC incident-reasoning orchestrator. Consumes the P2
 * substrate (alerts/changes via the provider) + the topology (CmdbGraphService),
 * and produces the gradeable IncidentAnalysis: correlation, recent-change-weighted
 * RCA, branch classification, timeline, impact (REUSED from the traversal), the
 * reportability surface, confidence-from-completeness, gaps, and a propose-only
 * recommended action. NO LLM here (T-CORRELATION-LLM) — narration is a separate
 * step. D16: all foreign reads go through the provider; no banking literal (§6.6).
 */
@Injectable()
export class IncidentReasoningService {
  private readonly logger = new Logger(IncidentReasoningService.name);
  private readonly syntheticLabel: string | null;

  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly graph: CmdbGraphService,
    private readonly packs: PackLoaderService,
    private readonly config: ConfigService,
  ) {
    const l = this.config.get<string>('SYNTHETIC_DATA_LABEL', '');
    this.syntheticLabel = l && l.length > 0 ? l : null;
  }

  async analyzeWindow(input: AnalyzeWindowInput): Promise<IncidentAnalysis | null> {
    const { tenantId, window } = input;
    const provider = await this.registry.getCmdbProvider(tenantId);
    if (!provider) return null;

    let alerts = await provider.getAlertsInWindow(window, tenantId);
    if (input.scenario) alerts = alerts.filter((a) => a.scenario === input.scenario);
    if (alerts.length === 0) return null;

    // ── CP8.1 correlation: collapse to one incident, root via topology coverage ──
    const distinctCis = [...new Set(alerts.map((a) => a.ciExternalId))];
    const coverByCi = new Map<string, Set<string>>();
    for (const ci of distinctCis) {
      const g = await this.graph.assembleImpactGraph(tenantId, { type: 'ci', ref: ci }, { direction: 'downstream' });
      const cover = new Set<string>([ci, ...g.dependencyChain.map((c) => c.externalId ?? c.id)]);
      coverByCi.set(ci, cover);
    }
    // Root = the alerting CI whose downstream coverage contains all other alerting
    // CIs (the shared dependency the storm collapses to). Deterministic.
    let root = distinctCis[0];
    let bestCover = -1;
    for (const ci of distinctCis) {
      const cover = coverByCi.get(ci)!;
      const coversAll = distinctCis.every((o) => cover.has(o));
      const size = cover.size;
      if (coversAll && size > bestCover) {
        root = ci;
        bestCover = size;
      }
    }

    const incident: Incident = {
      incidentId: `inc:${root}:${window.from.toISOString()}`,
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      memberAlertRefs: alerts.map((a) => a.alertId),
      memberCiExternalIds: distinctCis,
      rootCandidateCiRefs: [root],
      compressionRatio: `${alerts.length}:1`,
      rawAlertCount: alerts.length,
      incidentCount: 1,
    };

    // ── CP8.2 RCA: rank recent changes by proximity × recency ──────────────────
    const onsetMs = Math.min(...alerts.map((a) => Date.parse(a.firedAt)));
    const distanceByCi = new Map<string, number>();
    distinctCis.forEach((c) => distanceByCi.set(c, 0)); // members are on the incident
    for (const c of coverByCi.get(root) ?? []) if (!distanceByCi.has(c)) distanceByCi.set(c, 1);
    const changes = (await provider.getChangesInWindow(window, tenantId)).filter(
      (c) => !input.scenario || c.scenario === input.scenario,
    );
    const rankedCauses = rankRootCauses(changes, distanceByCi, onsetMs);
    const topCause: RankedCause | null = rankedCauses[0]?.score > 0 ? rankedCauses[0] : null;

    // ── impact: REUSE the Phase-2 traversal (never re-stated) ──────────────────
    const ig = await this.graph.assembleImpactGraph(tenantId, { type: 'ci', ref: root });
    const impact: IncidentImpact = {
      rootCiExternalId: root,
      services: ig.affectedServices.map((s) => s.name).sort(),
      customers: ig.totalCustomers,
      branches: ig.affectedNodeCount,
      customersClass: ig.totalCustomers !== null ? 'measured' : 'unavailable',
    };

    // ── CP8.3 branch classification ────────────────────────────────────────────
    const rootCi = await provider.findConfigurationItem(root, tenantId);
    const isBranchRoot = rootCi !== null && this.isCustomerBearing(rootCi);
    const classification = isBranchRoot
      ? classifyBranchFailure(true, alerts, impact.branches)
      : null;

    // ── CP8.4 timeline ─────────────────────────────────────────────────────────
    const topChange: ChangeEvent | null =
      topCause ? changes.find((c) => c.changeRef === topCause.changeRef) ?? null : null;
    const timeline = buildTimeline(alerts, topChange);

    // ── reportability (Assist, [verify]) ──────────────────────────────────────
    const pack = await this.loadPack(input.packId ?? 'default');
    const reg = this.packRegulatory(pack);
    const reportability = assessReportability(reg, {
      customerImpacting: impact.customers !== null && impact.customers > 0,
      securityIncident: alerts.some((a) => /ips|login|brute|security/i.test(`${a.metric} ${a.message}`)),
    });

    // ── gaps + confidence ──────────────────────────────────────────────────────
    const gaps: ContextGapRef[] = [];
    const drGap = await this.drGap(provider, rootCi, tenantId);
    if (drGap) gaps.push(drGap);
    if (impact.customers === null) {
      gaps.push({ scope: `ci:${root}`, missingInput: 'customer_count', degradedOutput: 'customers_affected_unavailable' });
    }
    if (classification?.pattern === 'indeterminate') {
      gaps.push({ scope: `ci:${root}`, missingInput: 'failure_cause', degradedOutput: 'cause_indeterminate' });
    }

    const confidence = computeConfidence({
      impactGrounded: impact.customers !== null && impact.customers > 0,
      changeExpectedButMissing: false,
      causeIndeterminate: classification?.pattern === 'indeterminate',
      drGap: !!drGap,
      securityFeedGated: false,
    });

    return {
      scenario: input.scenario ?? null,
      incident,
      rankedCauses,
      classification,
      timeline,
      impact,
      reportability,
      confidence,
      gaps,
      recommendedAction: recommendAction(rootCi?.name ?? null, topCause, classification),
      synthetic: this.syntheticLabel,
    };
  }

  private isCustomerBearing(ci: ConfigurationItem): boolean {
    const raw = ci.attributes?.['customer_count'];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0;
  }

  private async drGap(
    provider: DataSourceProvider,
    rootCi: ConfigurationItem | null,
    tenantId: string,
  ): Promise<ContextGapRef | null> {
    const drName = typeof rootCi?.attributes?.['dr_mapping'] === 'string' ? (rootCi.attributes['dr_mapping'] as string).trim() : '';
    if (!drName) return null;
    const drCi = await provider.findConfigurationItem(drName, tenantId);
    if (!drCi?.externalId) return null;
    const sig = await provider.getGoldenSignalsForCis([drCi.externalId], tenantId);
    if (sig.length === 0) {
      return { scope: `ci:${drCi.externalId}`, missingInput: 'dr_mirror_telemetry', degradedOutput: 'dr_posture_unknown' };
    }
    return null;
  }

  private async loadPack(packId: string): Promise<unknown | null> {
    try {
      return await this.packs.getPack(packId);
    } catch {
      return null;
    }
  }

  private packRegulatory(pack: unknown): Record<string, unknown> | null {
    const mappings = (pack as { cmdbMappings?: unknown } | null)?.cmdbMappings as Record<string, unknown> | undefined;
    const reg = mappings?.['regulatory_context'];
    return reg && typeof reg === 'object' ? (reg as Record<string, unknown>) : null;
  }
}
