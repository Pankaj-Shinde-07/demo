import { Injectable } from '@nestjs/common';
import { LlmGateway } from '../llm/llm-gateway.service';
import type { EvidenceItem } from '../llm/grounding';
import { DashboardTilesService } from './dashboard-tiles.service';
import type { BoardDigest, BoardDigestNarrative, DigestSection, Tile, Figure } from './dashboard.types';

// Clean human labels for the narrative evidence — the model must NEVER see raw
// DB field keys (it echoes them). Anything not mapped falls back to a de-snaked phrase.
const FIG_LABEL: Record<string, string> = {
  open_incidents: 'open incidents', alerts_correlated: 'correlated alerts',
  services_affected: 'services affected', customers_affected: 'customers affected',
  branches_affected: 'branches affected', revenue_at_risk_hourly: 'revenue at risk per hour',
  value_at_risk: 'value at risk for a one-hour outage', retention_at_risk: 'customer retention at risk',
  ci_up: 'healthy CIs', ci_degraded_or_down: 'degraded or down CIs',
  avg_compression_ratio: 'alert-to-incident compression', noc_hours_saved_monthly: 'NOC hours saved (run-rate, per month)',
  downtime_value_avoided_monthly: 'downtime value avoided (run-rate, per month)',
  penalties_averted_monthly: 'regulatory penalties averted (run-rate, per month)',
  retention_value_protected_monthly: 'customer-retention value protected (run-rate, per month)',
  idle_reclaim_candidates: 'idle / reclaimable CIs', at_capacity_ci: 'CIs at capacity', telemetered_ci: 'CIs with telemetry',
  tier1_with_dr_mapping: 'tier-1 services with a DR mapping', dr_posture_unverified: 'tier-1 services with unverified DR',
  reportable_obligations_surfaced: 'reportable regulatory obligations surfaced',
};
const figLabel = (m: string) => FIG_LABEL[m] ?? m.replace(/_/g, ' ');
const classWord = (c: Figure['class']) => (c === 'measured' ? 'measured' : c === 'derived' ? 'derived' : 'estimated, assumption-only');
function figValue(f: Figure): string {
  const v = f.value;
  if (f.unit?.startsWith('inr')) return '₹' + v.toLocaleString('en-IN') + (f.unit === 'inr_per_hour' ? '/hr' : '');
  if (f.unit === 'ratio_to_1') return v + '×';
  if (f.unit === 'pct' || f.unit === 'percent') return v + '%';
  if (f.unit === 'hours') return v + ' hours';
  if (f.unit === 'customers') return v.toLocaleString('en-IN') + ' customers';
  if (f.unit === 'count') return String(v);
  return `${v} ${f.unit}`;
}
// Gaps in clean English (no field keys), keyed by missingInput/degradedOutput.
const GAP_TEXT: Record<string, string> = {
  verified_rbi_specifics: 'specific RBI requirements are not yet verified — regulatory standing is an assist only; confirm against the current circular',
  specifics_pending_verify: 'specific RBI requirements are not yet verified — regulatory standing is an assist only; confirm against the current circular',
  dr_mirror_telemetry: 'a tier-1 service has no confirmed DR coverage — a board-visible continuity risk',
  dr_posture_unknown: 'a tier-1 service has no confirmed DR coverage — a board-visible continuity risk',
  accrued_value_history: 'no quarter-over-quarter trend has accrued yet — it builds once the tool has been running in the environment',
  qoq_trend_unavailable: 'no quarter-over-quarter trend has accrued yet — it builds once the tool has been running in the environment',
  onboarding_baseline: 'no before-Canaris baseline was captured — value-realized cannot yet be proven',
};
const gapText = (g: { missingInput: string; degradedOutput: string }) =>
  GAP_TEXT[g.missingInput] ?? GAP_TEXT[g.degradedOutput] ?? `${g.missingInput.replace(/_/g, ' ')} cannot be asserted`;

/**
 * W9 (CP9.4) — the monthly board digest: 6 CEO concern areas assembled
 * DETERMINISTICALLY from the classed tiles, with an LLM executive narrative via
 * the W5 gateway BOUNDED to the tiles (requireGrounding=true; the model uses only
 * tile figures — T-BOARD-FABRICATION). The centrepiece product surface.
 */
@Injectable()
export class BoardDigestService {
  constructor(
    private readonly tiles: DashboardTilesService,
    private readonly gateway: LlmGateway,
  ) {}

  /** Assemble the deterministic digest (no LLM). */
  async assemble(tenantId: string, packId = 'banking', period = 'current'): Promise<BoardDigest> {
    const [riskNow, serviceHealth, valueRealized, compliance, cost, bcpDr, trend] = await Promise.all([
      this.tiles.riskNow(tenantId, packId),
      this.tiles.serviceHealth(tenantId),
      this.tiles.valueRealized(tenantId, packId),
      this.tiles.compliance(tenantId, packId),
      this.tiles.costOptimization(tenantId),
      this.tiles.bcpDr(tenantId),
      this.tiles.roiTrend(tenantId, packId),
    ]);
    const sections: DigestSection[] = [
      { key: 'risk_now', title: 'Risk Now', tiles: [riskNow, serviceHealth] },
      { key: 'value_realized', title: 'Value Realized', tiles: [valueRealized] },
      { key: 'compliance', title: 'Compliance Standing', tiles: [compliance] },
      { key: 'cost', title: 'Cost / Optimization', tiles: [cost] },
      { key: 'bcp_dr', title: 'BCP / DR Posture', tiles: [bcpDr] },
      { key: 'trend', title: 'Value Trend', tiles: [trend] },
    ];
    const label = riskNow.label ?? valueRealized.label ?? null;
    return { tenantId, period, sections, narrative: null, label };
  }

  // Per-tenant narrative cache: the LLM call is ~30s and varies per run, so we
  // generate once and serve instantly on every load; only an explicit
  // regenerate re-runs it. Sections are always assembled fresh. (In-memory —
  // cleared on restart; the first load after a restart regenerates once.)
  private readonly narrativeCache = new Map<string, BoardDigestNarrative>();

  /** Assemble + narrate (the executive summary bounded to the tiles). Cached. */
  async assembleWithNarrative(tenantId: string, packId = 'banking', period = 'current', regenerate = false): Promise<BoardDigest> {
    const digest = await this.assemble(tenantId, packId, period);
    const cached = this.narrativeCache.get(tenantId);
    if (cached && !regenerate) { digest.narrative = cached; return digest; }
    const r = await this.gateway.complete({
      tenantId,
      templateId: 'board_digest',
      packId,
      question:
        'You are writing the CEO/board executive summary. The evidence is already in plain English — each item is a readable label, a value, and a confidence word in parentheses. STRICT RULES: ' +
        '(1) Write natural English prose ONLY — NEVER output raw field identifiers, underscores, or bracketed codes (never "open_incidents", "avg_compression_ratio", "[gap: ...]", "[Class-1 ...]"); translate everything into words. ' +
        '(2) Write 3 to 4 SHORT paragraphs, headline-first: open with the value delivered and the single open incident with its business impact; do NOT march through every section in order — the dashboard tiles below already list them. ' +
        '(3) Use a confidence word — "measured", "derived", or "estimated, assumption-only" — ONLY on the load-bearing figures (the headline value and the revenue-at-risk), once each; do not tag every number. ' +
        '(4) State caveats ONCE, briefly and naturally: value figures are a current run-rate, not elapsed actuals; regulatory standing is an assist only — not a definitive position, confirm against current RBI circulars; flag the one board-visible DR gap; note no quarter-over-quarter trend has accrued yet; and that this is synthetic demonstration data. ' +
        '(5) Tone: executive, plain, confident but honest. Do NOT add a title or header — begin with the first paragraph.',
      evidence: this.digestEvidence(digest),
      requireGrounding: true,
      maxTokens: 2500, // a multi-paragraph executive summary; avoid truncating the structured output
    });
    const narrative: BoardDigestNarrative = { content: r.content, grounded: r.grounded, declined: r.declined, evidenceRefs: r.evidenceRefs, model: r.model };
    this.narrativeCache.set(tenantId, narrative);
    digest.narrative = narrative;
    return digest;
  }

  /** Every tile figure becomes one grounding evidence item — the narrative's bound.
   *  Content is CLEAN plain English (label + value + confidence word) so the model
   *  never sees a raw DB key to echo; the id keeps the field key for grounding refs. */
  digestEvidence(digest: BoardDigest): EvidenceItem[] {
    const ev: EvidenceItem[] = [];
    for (const section of digest.sections) {
      for (const tile of section.tiles) {
        for (const f of tile.figures) {
          const assumes = f.assumptions.length ? `; assumes ${f.assumptions.map((a) => a.description).join('; ')}` : '';
          ev.push({
            id: `tile:${tile.id}:${f.metric}`,
            label: `${tile.title} — ${figLabel(f.metric)}`,
            content: `${tile.title}: ${figLabel(f.metric)} is ${figValue(f)} (${classWord(f.class)})${assumes}.`,
          });
        }
        tile.notes.forEach((n, i) => ev.push({ id: `note:${tile.id}:${i}`, label: `${tile.title} note`, content: n }));
        for (const g of tile.gaps) ev.push({ id: `gap:${tile.id}:${g.missingInput}`, label: `${tile.title} — open gap`, content: `${tile.title}: ${gapText(g)}.` });
      }
    }
    if (digest.label) ev.push({ id: 'disclosure:synthetic', label: 'Data disclosure', content: `Data context: ${digest.label}.` });
    return ev;
  }

  /** All tile figure values (normalized) — the allowed set for the narrative⊆tiles check. */
  static tileFigureValues(digest: BoardDigest): Set<number> {
    const set = new Set<number>();
    for (const s of digest.sections) for (const t of s.tiles) for (const f of t.figures) set.add(f.value);
    return set;
  }

  /** Flatten all tiles (for lints/tests). */
  static allTiles(digest: BoardDigest): Tile[] {
    return digest.sections.flatMap((s) => s.tiles);
  }

  /**
   * "No number without class" (T-BOARD-FABRICATION): every board figure carries a
   * class + non-empty grounding; a Class-1 (measured) figure carries no assumption.
   */
  static checkFiguresClassed(digest: BoardDigest): { ok: boolean; violations: string[] } {
    const violations: string[] = [];
    for (const t of BoardDigestService.allTiles(digest)) {
      for (const f of t.figures) {
        if (!f.class || !f.classLabel) violations.push(`${t.id}.${f.metric}: missing class`);
        if (f.groundingInputs.length === 0) violations.push(`${t.id}.${f.metric}: empty grounding`);
        if (f.class === 'measured' && f.assumptions.length > 0) violations.push(`${t.id}.${f.metric}: Class-1 carries an assumption`);
      }
    }
    return { ok: violations.length === 0, violations };
  }

  /**
   * "Narrative ⊆ tiles" (T-BOARD-FABRICATION): every BIG number (≥1000 — the
   * rupee/customer board figures, the fabrication risk) in the narrative traces
   * to a tile figure value. Small ordinals/percentages are not board figures.
   */
  static checkNarrativeInTiles(narrative: string, digest: BoardDigest): { ok: boolean; orphans: number[] } {
    const tileValues = BoardDigestService.tileFigureValues(digest);
    // Allow lakh/crore reformatting of tile values.
    const allowed = new Set<number>(tileValues);
    for (const v of tileValues) {
      allowed.add(Math.round(v / 100000)); // "X lakh"
      allowed.add(Math.round(v / 10000000)); // "X crore"
    }
    // Standalone numbers only — exclude digit-runs embedded in identifiers
    // (CHG-20260610-001, CI-0010) via lookbehind/ahead for word-chars/hyphens.
    const nums = (narrative.match(/(?<![\w-])\d[\d,]*(?:\.\d+)?(?![\w-])/g) ?? [])
      .map((s) => Number(s.replace(/,/g, '')))
      .filter((n) => Number.isFinite(n) && n >= 1000);
    const orphans = nums.filter((n) => !allowed.has(n));
    return { ok: orphans.length === 0, orphans };
  }
}
