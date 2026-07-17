// W6 Phase 2 (D15, ADR-005) — builds the three-class business_impact block from
// the CP6.3 impact graph + the pack value-model. The governing rule: a figure's
// CLASS is computed from the grounding inputs actually present, never assumed in
// advance — so the same code yields an honest answer whatever the spine carries.
// No banking literal (§6.6): everything is generic figures + gaps.

import type { CriticalityTier } from '../datasource/data-source.types';
import type { ImpactGraph, ContextGap } from './impact-graph.types';
import type { ValueModel } from '../packs/value-model.schema';
import {
  CLASS_LABEL,
  type Assumption,
  type BusinessImpactBlock,
  type Figure,
  type FigureClass,
  type GroundingInput,
} from './business-impact.types';

function figure(
  metric: string,
  value: number,
  unit: string,
  cls: FigureClass,
  groundingInputs: GroundingInput[],
  assumptions: Assumption[] = [],
): Figure {
  return {
    metric,
    value,
    unit,
    class: cls,
    classLabel: CLASS_LABEL[cls],
    groundingInputs,
    assumptions,
  };
}

export interface BuildBusinessImpactOptions {
  criticalityTier: CriticalityTier;
  valueModel: ValueModel | null;
  /** Standing disclosure label (e.g. "SynthBank synthetic data") or null. */
  syntheticDataLabel: string | null;
}

export function buildBusinessImpact(
  graph: ImpactGraph,
  opts: BuildBusinessImpactOptions,
): BusinessImpactBlock {
  const figures: Figure[] = [];
  const gaps: ContextGap[] = [];
  const { valueModel } = opts;

  // ── services_affected (Class-1 measured) ────────────────────────────────────
  const serviceGrounding: GroundingInput[] = graph.affectedServices.map((s) => ({
    ref: `cmdb:svc:${s.name}`,
    description: `service ${s.name} (criticality ${s.criticalityTier})`,
  }));
  if (serviceGrounding.length > 0) {
    figures.push(
      figure('services_affected', graph.affectedServices.length, 'count', 'measured', serviceGrounding),
    );
  } else {
    gaps.push({ scope: 'graph', missingInput: 'service_links', degradedOutput: 'services_affected_unavailable' });
  }

  // ── customers_affected + branches_affected (Class-1 measured) ────────────────
  const customerGrounding: GroundingInput[] = graph.customerBearingNodes.map((n) => ({
    ref: `cmdb:ci:${n.externalId ?? n.ciId}`,
    description: `${n.name}: ${n.customerCount} customers${n.segment ? ` (${n.segment})` : ''}`,
  }));
  if (graph.totalCustomers !== null && graph.totalCustomers > 0 && customerGrounding.length > 0) {
    figures.push(
      figure('customers_affected', graph.totalCustomers, 'customers', 'measured', customerGrounding),
    );
    figures.push(
      figure('branches_affected', graph.affectedNodeCount, 'count', 'measured', customerGrounding),
    );
  } else {
    gaps.push({ scope: 'graph', missingInput: 'customer_count', degradedOutput: 'customers_affected_unavailable' });
  }

  // ── value-at-risk ───────────────────────────────────────────────────────────
  // Measured hourly rate (Class-1) summed from services that declare it; the
  // derived total (Class-2) multiplies it by the pack's assumed outage duration.
  const revenueServices = graph.affectedServices.filter(
    (s) => s.revenueImpactHourly !== null && Number.isFinite(Number(s.revenueImpactHourly)),
  );
  const measuredHourly = revenueServices.reduce((sum, s) => sum + Number(s.revenueImpactHourly), 0);
  const revenueGrounding: GroundingInput[] = revenueServices.map((s) => ({
    ref: `cmdb:svc:${s.name}`,
    description: `${s.name} revenue_impact_hourly=${s.revenueImpactHourly}`,
  }));

  if (revenueGrounding.length > 0 && measuredHourly > 0) {
    figures.push(
      figure('revenue_at_risk_hourly', measuredHourly, 'inr_per_hour', 'measured', revenueGrounding),
    );
    if (valueModel) {
      const hours = valueModel.valueAtRisk.estimatedOutageHours.value;
      const total = Math.round(measuredHourly * hours);
      figures.push(
        figure('value_at_risk', total, 'inr', 'derived', revenueGrounding, [
          {
            description: `${valueModel.valueAtRisk.basis}; estimated_outage_hours=${hours}`,
            verify: valueModel.valueAtRisk.estimatedOutageHours.verify,
          },
        ]),
      );
    } else {
      gaps.push({ scope: 'graph', missingInput: 'value_model', degradedOutput: 'value_at_risk_unavailable' });
    }
  } else {
    gaps.push({ scope: 'graph', missingInput: 'revenue_impact_hourly', degradedOutput: 'value_at_risk_unavailable' });
  }

  // ── retention / churn (Class-3 estimated, assumption-only) ───────────────────
  const churnPct = valueModel?.retention.monthlyChurnRatePct.value ?? 0;
  if (
    valueModel &&
    churnPct > 0 &&
    graph.totalCustomers !== null &&
    graph.totalCustomers > 0 &&
    customerGrounding.length > 0
  ) {
    const atRiskCustomers = Math.round((graph.totalCustomers * churnPct) / 100);
    figures.push(
      figure('retention_at_risk', atRiskCustomers, 'customers', 'estimated', customerGrounding, [
        {
          description: `assumed monthly churn ${churnPct}% applied to measured customer base (assumption-only; ${valueModel.retention.note})`,
          verify: valueModel.retention.monthlyChurnRatePct.verify,
        },
      ]),
    );
  }

  return {
    criticalityTier: opts.criticalityTier,
    affectedServiceNames: graph.affectedServices.map((s) => s.name),
    figures,
    syntheticDataLabel: opts.syntheticDataLabel,
    gaps,
  };
}
