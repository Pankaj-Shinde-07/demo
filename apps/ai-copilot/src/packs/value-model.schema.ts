import { z } from 'zod';

/**
 * W6 Phase 2 (CP6.5) — the value-model a pack supplies to the D15 business_impact
 * fill. Carries ONLY the figures that are genuinely assumptions (ADR-005):
 *   - value_at_risk.estimated_outage_hours → Class-2 (derived) duration factor
 *   - retention.monthly_churn_rate_pct     → Class-3 (assumption-only) churn
 * Customer/branch counts are NOT here — they are Class-1 spine data (§FROZEN).
 *
 * Each coefficient carries a `verify` tag ([ucb-verify]/[verify]) flagging that
 * a measured real-world figure should eventually replace the placeholder.
 */

const CoefficientSchema = z.object({
  value: z.number(),
  verify: z.string().min(1),
});
export type ValueModelCoefficient = z.infer<typeof CoefficientSchema>;

export const ValueModelSchema = z.object({
  value_at_risk: z.object({
    estimated_outage_hours: CoefficientSchema,
    basis: z.string().min(1),
  }),
  retention: z.object({
    monthly_churn_rate_pct: CoefficientSchema,
    note: z.string().min(1),
  }),
  // W9 (CP9.3) — ROI / Value-Realized coefficients. Optional: a pack without an
  // `roi` block yields valueModel.roi=null and the ROI tile degrades honestly.
  roi: z
    .object({
      triage_share_pct: CoefficientSchema,
      mttr_reduction_pct: CoefficientSchema,
      monthly_penalty_estimate_inr: CoefficientSchema,
      note: z.string().min(1),
    })
    .optional(),
});

export type ValueModelRaw = z.infer<typeof ValueModelSchema>;

/** Engine-facing shape (camelCase), resolved from the validated YAML. */
export interface ValueModel {
  valueAtRisk: {
    estimatedOutageHours: ValueModelCoefficient;
    basis: string;
  };
  retention: {
    monthlyChurnRatePct: ValueModelCoefficient;
    note: string;
  };
  roi: {
    triageSharePct: ValueModelCoefficient;
    mttrReductionPct: ValueModelCoefficient;
    monthlyPenaltyEstimateInr: ValueModelCoefficient;
    note: string;
  } | null;
}

export function toValueModel(raw: ValueModelRaw): ValueModel {
  return {
    valueAtRisk: {
      estimatedOutageHours: raw.value_at_risk.estimated_outage_hours,
      basis: raw.value_at_risk.basis,
    },
    retention: {
      monthlyChurnRatePct: raw.retention.monthly_churn_rate_pct,
      note: raw.retention.note,
    },
    roi: raw.roi
      ? {
          triageSharePct: raw.roi.triage_share_pct,
          mttrReductionPct: raw.roi.mttr_reduction_pct,
          monthlyPenaltyEstimateInr: raw.roi.monthly_penalty_estimate_inr,
          note: raw.roi.note,
        }
      : null,
  };
}
