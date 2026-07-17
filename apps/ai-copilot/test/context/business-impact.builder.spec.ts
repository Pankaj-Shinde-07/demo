import { buildBusinessImpact } from '../../src/context/business-impact.builder';
import type { ImpactGraph } from '../../src/context/impact-graph.types';
import type { Figure } from '../../src/context/business-impact.types';
import type { ValueModel } from '../../src/packs/value-model.schema';
import type { BusinessService } from '../../src/datasource/data-source.types';

/**
 * D15 hard-rule proofs (ADR-005):
 *   - every emitted figure has NON-EMPTY grounding_inputs;
 *   - class==='measured' (Class-1) ⇒ assumptions is EMPTY;
 *   - NO bare number anywhere outside figures;
 *   - class is computed from the grounding actually present (measured / derived /
 *     estimated), not assumed in advance.
 */

const VALUE_MODEL: ValueModel = {
  valueAtRisk: {
    estimatedOutageHours: { value: 2, verify: '[ucb-verify] mttr' },
    basis: 'Class-2 derived: revenue_impact_hourly × estimated_outage_hours',
  },
  retention: {
    monthlyChurnRatePct: { value: 0.5, verify: '[ucb-verify] churn' },
    note: 'assumption-only',
  },
};

function svc(name: string, revenue: string | null): BusinessService {
  return {
    id: `svc-${name}`,
    name,
    description: null,
    criticalityTier: 'tier-1',
    businessOwnerId: null,
    businessOwner: null,
    rtoMinutes: null,
    rpoMinutes: null,
    revenueImpactHourly: revenue,
    source: 'fake',
  };
}

function graphWith(opts: {
  services?: BusinessService[];
  customers?: Array<{ id: string; ext: string; count: number; seg?: string }>;
}): ImpactGraph {
  return {
    seed: { type: 'ci', ref: 'S', id: 'S', externalId: 'CI-0005', name: 'Seed' },
    resolved: true,
    direction: 'downstream',
    maxDepth: 6,
    depthReached: 1,
    affectedServices: opts.services ?? [],
    dependencyChain: [],
    customerBearingNodes: (opts.customers ?? []).map((c) => ({
      ciId: c.id,
      externalId: c.ext,
      name: c.ext,
      customerCount: c.count,
      segment: c.seg ?? null,
    })),
    totalCustomers: (opts.customers ?? []).reduce((s, c) => s + c.count, 0) || null,
    affectedNodeCount: (opts.customers ?? []).length,
    edges: [],
    gaps: [],
    cacheHit: false,
    cyclesCut: 0,
  };
}

/** Recursively assert no number exists outside the `figures` array. */
function assertNoBareNumber(block: unknown): void {
  const walk = (node: unknown, insideFigures: boolean): void => {
    if (typeof node === 'number') {
      if (!insideFigures) throw new Error(`bare number found outside figures: ${node}`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v) => walk(v, insideFigures));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        walk(v, insideFigures || k === 'figures');
      }
    }
  };
  walk(block, false);
}

const byMetric = (figs: Figure[], m: string) => figs.find((f) => f.metric === m);

describe('D15 business_impact builder', () => {
  it('emits classed figures with the hard-rule invariants held', () => {
    const graph = graphWith({
      services: [svc('rail_a', '1800000.00'), svc('rail_b', '1200000.00')],
      customers: [
        { id: 'b1', ext: 'CI-0053', count: 25000, seg: 'urban' },
        { id: 'b2', ext: 'CI-0011', count: 5000, seg: 'standard' },
      ],
    });
    const block = buildBusinessImpact(graph, {
      criticalityTier: 'tier-1',
      valueModel: VALUE_MODEL,
      syntheticDataLabel: 'SynthBank synthetic data',
    });

    // hard rules
    assertNoBareNumber(block);
    for (const f of block.figures) {
      expect(f.groundingInputs.length).toBeGreaterThan(0); // non-empty grounding
      if (f.class === 'measured') expect(f.assumptions).toHaveLength(0); // Class-1 ⇒ no assumptions
    }

    // class correctness
    expect(byMetric(block.figures, 'services_affected')?.class).toBe('measured');
    expect(byMetric(block.figures, 'customers_affected')?.class).toBe('measured');
    expect(byMetric(block.figures, 'customers_affected')?.value).toBe(30000);
    expect(byMetric(block.figures, 'revenue_at_risk_hourly')?.class).toBe('measured');
    expect(byMetric(block.figures, 'revenue_at_risk_hourly')?.value).toBe(3000000);

    const var2 = byMetric(block.figures, 'value_at_risk');
    expect(var2?.class).toBe('derived'); // Class-2
    expect(var2?.value).toBe(6000000); // 3,000,000/h × 2h
    expect(var2?.assumptions.length).toBeGreaterThan(0);
    expect(var2?.assumptions[0].verify).toContain('[ucb-verify]');

    const ret = byMetric(block.figures, 'retention_at_risk');
    expect(ret?.class).toBe('estimated'); // Class-3
    expect(ret?.assumptions.length).toBeGreaterThan(0);

    expect(block.syntheticDataLabel).toBe('SynthBank synthetic data');
  });

  it('omits the value-at-risk total and names a gap when no value-model is present', () => {
    const graph = graphWith({ services: [svc('rail_a', '1000000.00')], customers: [] });
    const block = buildBusinessImpact(graph, {
      criticalityTier: 'tier-1',
      valueModel: null,
      syntheticDataLabel: null,
    });
    // measured hourly still emitted (Class-1); derived total withheld + gapped.
    expect(byMetric(block.figures, 'revenue_at_risk_hourly')?.class).toBe('measured');
    expect(byMetric(block.figures, 'value_at_risk')).toBeUndefined();
    expect(block.gaps).toContainEqual({
      scope: 'graph',
      missingInput: 'value_model',
      degradedOutput: 'value_at_risk_unavailable',
    });
  });

  it('does not emit a Class-1 customers figure when customer grounding is absent', () => {
    const graph = graphWith({ services: [svc('rail_a', null)], customers: [] });
    const block = buildBusinessImpact(graph, {
      criticalityTier: 'tier-1',
      valueModel: VALUE_MODEL,
      syntheticDataLabel: null,
    });
    expect(byMetric(block.figures, 'customers_affected')).toBeUndefined();
    expect(block.gaps).toContainEqual({
      scope: 'graph',
      missingInput: 'customer_count',
      degradedOutput: 'customers_affected_unavailable',
    });
  });
});
