import { composeGaps } from '../../src/context/degradation-matrix';
import type { ConfigurationItem, BusinessService } from '../../src/datasource/data-source.types';
import type { ImpactGraph } from '../../src/context/impact-graph.types';
import type { BusinessImpactBlock } from '../../src/context/business-impact.types';
import type { ApplicationPerformanceBlock } from '../../src/context/application-performance.types';

/**
 * CP6.4 proofs: a missing input degrades a named output (degrade-don't-fabricate)
 * and the deliberate SynthBank DR-coverage gap surfaces as a named gap.
 */

function ci(attrs: Record<string, unknown>, tier: ConfigurationItem['criticalityTier'] = 'tier-1'): ConfigurationItem {
  return {
    id: 'ci1',
    externalId: 'CI-0042',
    ciType: 'node',
    name: 'Node 42',
    description: null,
    criticalityTier: tier,
    technicalOwner: null,
    businessOwner: null,
    operationsTeam: null,
    linkedAssetRef: null,
    attributes: attrs,
    source: 'fake',
  };
}

const emptyImpact: ImpactGraph = {
  seed: { type: 'ci', ref: 'ci1', id: 'ci1', externalId: 'CI-0042', name: 'Node 42' },
  resolved: true,
  direction: 'downstream',
  maxDepth: 6,
  depthReached: 0,
  affectedServices: [],
  dependencyChain: [],
  customerBearingNodes: [],
  totalCustomers: null,
  affectedNodeCount: 0,
  edges: [],
  gaps: [],
  cacheHit: false,
  cyclesCut: 0,
};

const emptyBI: BusinessImpactBlock = {
  criticalityTier: 'tier-1',
  affectedServiceNames: [],
  figures: [],
  syntheticDataLabel: null,
  gaps: [],
};

const emptyApm: ApplicationPerformanceBlock = {
  completeness: 'empty',
  signals: [],
  gaps: [{ scope: 'application_performance', missingInput: 'tier_a_telemetry', degradedOutput: 'golden_signals_unavailable' }],
  source: { provider: 'fake', type: 'native' },
};

describe('CP6.4 degradation matrix', () => {
  it('names owner / tier / relationships / service / DR gaps for a starved CI', () => {
    const gaps = composeGaps({
      ci: ci({ dr_mapping: '' }, 'unknown'), // no owner, unknown tier, empty DR
      services: [] as BusinessService[],
      relCount: 0,
      impact: emptyImpact,
      businessImpact: emptyBI,
      applicationPerformance: emptyApm,
    });
    const outputs = gaps.map((g) => g.degradedOutput);
    expect(outputs).toContain('ownership_unavailable');
    expect(outputs).toContain('tier_prioritization_unavailable');
    expect(outputs).toContain('dependency_chain_truncated');
    expect(outputs).toContain('blast_radius_unavailable');
    expect(outputs).toContain('dr_coverage_unverified'); // DR-gap showcase
    expect(outputs).toContain('golden_signals_unavailable'); // APM gap merged
  });

  it('does NOT raise owner/tier/DR gaps when those inputs are present', () => {
    const wellFormed = ci({ dr_mapping: 'DR Node B' }, 'tier-1');
    wellFormed.technicalOwner = { id: 'o1', name: 'Ops', email: null, kind: 'team' };
    const gaps = composeGaps({
      ci: wellFormed,
      services: [{ id: 's1', name: 'svc', description: null, criticalityTier: 'tier-1', businessOwnerId: null, businessOwner: null, rtoMinutes: null, rpoMinutes: null, revenueImpactHourly: '1', source: 'fake' }],
      relCount: 3,
      impact: emptyImpact,
      businessImpact: emptyBI,
      applicationPerformance: { ...emptyApm, gaps: [] },
    });
    const outputs = gaps.map((g) => g.degradedOutput);
    expect(outputs).not.toContain('ownership_unavailable');
    expect(outputs).not.toContain('tier_prioritization_unavailable');
    expect(outputs).not.toContain('dr_coverage_unverified');
    expect(outputs).not.toContain('blast_radius_unavailable');
  });

  it('dedupes identical gaps from multiple sources', () => {
    const dup = { scope: 'graph', missingInput: 'x', degradedOutput: 'y' };
    const gaps = composeGaps({
      ci: ci({ dr_mapping: 'covered' }, 'tier-1'),
      services: [{ id: 's1', name: 'svc', description: null, criticalityTier: 'tier-1', businessOwnerId: null, businessOwner: null, rtoMinutes: null, rpoMinutes: null, revenueImpactHourly: null, source: 'fake' }],
      relCount: 1,
      impact: { ...emptyImpact, gaps: [dup] },
      businessImpact: { ...emptyBI, gaps: [dup] },
      applicationPerformance: { ...emptyApm, gaps: [] },
    });
    const owner = gaps.find((g) => g.scope === 'ci:CI-0042' && g.missingInput === 'owner');
    expect(owner).toBeDefined(); // owner gap still raised
    expect(gaps.filter((g) => g.missingInput === 'x')).toHaveLength(1); // deduped
  });
});
