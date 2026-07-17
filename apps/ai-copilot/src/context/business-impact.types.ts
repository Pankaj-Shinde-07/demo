// W6 Phase 2 (D15, ADR-005) — the three-class business_impact block. The moat's
// centre of gravity: every emitted figure declares HOW it is grounded, so an
// answer can never present an ungrounded number as fact.
//
// No banking literal here (§6.6): a figure is a generic { value, class,
// grounding, assumptions } object whatever the vertical.

import type { CriticalityTier } from '../datasource/data-source.types';
import type { ContextGap } from './impact-graph.types';

/**
 * The honesty class of a figure (ADR-005):
 *   measured  = Class-1 — read directly from measured data (counts, spine facts)
 *   derived   = Class-2 — measured input(s) combined with a declared assumption
 *   estimated = Class-3 — assumption-dominated; never asserted as fact
 */
export type FigureClass = 'measured' | 'derived' | 'estimated';

export const CLASS_LABEL: Record<FigureClass, string> = {
  measured: 'Class-1 (measured)',
  derived: 'Class-2 (derived)',
  estimated: 'Class-3 (estimated)',
};

/** A piece of measured grounding a figure rests on (an evidence ref). */
export interface GroundingInput {
  ref: string; // e.g. 'cmdb:svc:upi_imps' | 'cmdb:ci:CI-0053'
  description: string;
}

/** A declared assumption a derived/estimated figure depends on. */
export interface Assumption {
  description: string;
  /** The pack's [ucb-verify]/[verify] tag, when the assumption is a pack coefficient. */
  verify: string | null;
}

/**
 * A single emitted figure. THE HARD RULE (lint/test-checked):
 *   - groundingInputs is NON-EMPTY (a classed figure with no grounding is a defect)
 *   - class==='measured' ⇒ assumptions is EMPTY (measured means measured)
 *   - the number lives ONLY here — there are no bare numbers in the block
 */
export interface Figure {
  metric: string; // 'services_affected' | 'customers_affected' | 'value_at_risk_hourly' | ...
  value: number;
  unit: string; // 'count' | 'customers' | 'inr_per_hour' | 'inr' | ...
  class: FigureClass;
  classLabel: string;
  groundingInputs: GroundingInput[];
  assumptions: Assumption[];
}

/**
 * The structured business_impact block. Replaces the Phase-1 generic
 * `revenueAtRiskHourly: null` placeholder. Figures are the only numbers; the
 * names/labels are strings. Any figure that could not be grounded is recorded as
 * a named gap, never fabricated.
 */
export interface BusinessImpactBlock {
  criticalityTier: CriticalityTier;
  /** Names of the services impacted (the human list; the COUNT is a figure). */
  affectedServiceNames: string[];
  /** The classed figures — every number carries its class + grounding. */
  figures: Figure[];
  /**
   * Standing demo-discipline disclosure (e.g. "SynthBank synthetic data"),
   * threaded from config — null in a real deployment. Not a banking literal.
   */
  syntheticDataLabel: string | null;
  /** Figures that could not be emitted → named gaps (degrade-don't-fabricate). */
  gaps: ContextGap[];
}
