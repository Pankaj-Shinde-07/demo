import { CmdbGraphService } from '../../src/context/cmdb-graph.service';
import type {
  BusinessService,
  CiRelationship,
  CiRelationshipGraph,
  ConfigurationItem,
} from '../../src/datasource/data-source.types';

/**
 * CP6.3 traversal proofs (no DB): a fake in-memory DataSourceProvider + a
 * Map-backed fake Redis exercise depth-bounding, cycle termination,
 * partial-graph gap reporting, customer dedup, and cache read-through.
 */

function ci(id: string, extras: Partial<ConfigurationItem> = {}): ConfigurationItem {
  return {
    id,
    externalId: id,
    ciType: 'node',
    name: id,
    description: null,
    criticalityTier: 'tier-1',
    technicalOwner: null,
    businessOwner: null,
    operationsTeam: null,
    linkedAssetRef: null,
    attributes: {},
    source: 'fake',
    ...extras,
  };
}

function svc(id: string, name: string): BusinessService {
  return {
    id,
    name,
    description: null,
    criticalityTier: 'tier-1',
    businessOwnerId: null,
    businessOwner: null,
    rtoMinutes: null,
    rpoMinutes: null,
    revenueImpactHourly: '1000.00',
    source: 'fake',
  };
}

interface World {
  cis: Map<string, ConfigurationItem>;
  edges: CiRelationship[]; // source depends? we treat sourceCiId -> targetCiId
  servicesByCi: Map<string, BusinessService[]>; // CI -> services it is linked to
  cisByService: Map<string, ConfigurationItem[]>; // service id -> linked CIs
}

function fakeProvider(w: World) {
  return {
    name: 'fake',
    type: 'native' as const,
    async getConfigurationItem(id: string) {
      return w.cis.get(id) ?? null;
    },
    async findConfigurationItem(ref: string) {
      return w.cis.get(ref) ?? null;
    },
    async getServicesAffectedByCi(ciId: string) {
      return w.servicesByCi.get(ciId) ?? [];
    },
    async getCisForService(serviceId: string) {
      return w.cisByService.get(serviceId) ?? [];
    },
    async getBusinessService() {
      return null;
    },
    async getCiRelationships(ciId: string): Promise<CiRelationshipGraph> {
      const edges = w.edges.filter((e) => e.sourceCiId === ciId || e.targetCiId === ciId);
      const upstreamIds = edges.filter((e) => e.sourceCiId === ciId).map((e) => e.targetCiId);
      const downstreamIds = edges.filter((e) => e.targetCiId === ciId).map((e) => e.sourceCiId);
      const resolve = (ids: string[]) =>
        ids.map((id) => w.cis.get(id)).filter((x): x is ConfigurationItem => !!x);
      return {
        rootCiId: ciId,
        depth: 1,
        upstream: resolve(upstreamIds),
        downstream: resolve(downstreamIds),
        edges,
      };
    },
  };
}

function makeService(provider: ReturnType<typeof fakeProvider>, redisStore = new Map<string, string>()) {
  const registry = { getCmdbProvider: async () => provider } as any;
  const config = { get: (_k: string, d: unknown) => d } as any;
  const redis = {
    async get(k: string) {
      return redisStore.get(k) ?? null;
    },
    async set(k: string, v: string) {
      redisStore.set(k, v);
      return 'OK';
    },
  } as any;
  return { service: new CmdbGraphService(registry, config, redis), redisStore };
}

const edge = (s: string, t: string): CiRelationship => ({
  sourceCiId: s,
  targetCiId: t,
  relationshipType: 'depends_on',
  metadata: {},
});

describe('CmdbGraphService (CP6.3)', () => {
  it('traverses downstream dependents, depth-bounded, and counts deduped customers', async () => {
    // S (seed) ← A ← B  (A depends on S; B depends on A). Branches br1,br2 carry
    // customer counts and are linked to two affected services each (dedup test).
    const branch1 = ci('br1', { attributes: { customer_count: 25000, branch_type: 'urban' } });
    const branch2 = ci('br2', { attributes: { customer_count: 5000, branch_type: 'standard' } });
    const w: World = {
      cis: new Map([
        ['S', ci('S')],
        ['A', ci('A')],
        ['B', ci('B')],
        ['br1', branch1],
        ['br2', branch2],
      ]),
      edges: [edge('A', 'S'), edge('B', 'A')],
      servicesByCi: new Map([['S', [svc('svc1', 'rail_one'), svc('svc2', 'rail_two')]]]),
      cisByService: new Map([
        ['svc1', [branch1, branch2]],
        ['svc2', [branch1, branch2]], // same branches via a second service → must dedup
      ]),
    };
    const { service } = makeService(fakeProvider(w));
    const g = await service.assembleImpactGraph('t1', { type: 'ci', ref: 'S' });

    expect(g.resolved).toBe(true);
    expect(g.dependencyChain.map((c) => c.id).sort()).toEqual(['A', 'B']);
    expect(g.depthReached).toBe(2);
    expect(g.affectedNodeCount).toBe(2); // deduped
    expect(g.totalCustomers).toBe(30000); // 25000 + 5000, not doubled
    expect(g.gaps).toHaveLength(0);
  });

  it('discriminates a branch-local (customer-bearing) seed to its OWN customers, not estate-wide', async () => {
    // The seed IS a customer-bearing leaf (a branch). It shares service svc1 with
    // a sibling branch. A branch-local failure must scope to its own 5,000 — NOT
    // both branches (that is the shared-rail case, tested above).
    const seedBranch = ci('S', { attributes: { customer_count: 5000, branch_type: 'standard' } });
    const sibling = ci('B2', { attributes: { customer_count: 5000, branch_type: 'standard' } });
    const w: World = {
      cis: new Map([
        ['S', seedBranch],
        ['B2', sibling],
      ]),
      edges: [],
      servicesByCi: new Map([['S', [svc('svc1', 'shared_rail')]]]),
      cisByService: new Map([['svc1', [seedBranch, sibling]]]), // both consume svc1
    };
    const { service } = makeService(fakeProvider(w));
    const g = await service.assembleImpactGraph('t1', { type: 'ci', ref: 'S' });
    expect(g.affectedNodeCount).toBe(1); // only the seed branch
    expect(g.totalCustomers).toBe(5000); // NOT 10,000 — does not pull in the sibling
  });

  it('terminates on a cycle and records cyclesCut', async () => {
    // S ← A ← S  (cycle: A depends on S, S depends on A).
    const w: World = {
      cis: new Map([
        ['S', ci('S')],
        ['A', ci('A')],
      ]),
      edges: [edge('A', 'S'), edge('S', 'A')],
      servicesByCi: new Map(),
      cisByService: new Map(),
    };
    const { service } = makeService(fakeProvider(w));
    const g = await service.assembleImpactGraph('t1', { type: 'ci', ref: 'S' });
    expect(g.resolved).toBe(true);
    expect(g.cyclesCut).toBeGreaterThan(0);
    // S's downstream is A; A's downstream is S (already visited) → cut.
    expect(g.dependencyChain.map((c) => c.id)).toEqual(['A']);
  });

  it('reports a dangling edge as a named gap and still completes', async () => {
    // S has an edge to a non-existent CI 'ghost'.
    const w: World = {
      cis: new Map([['S', ci('S')]]),
      edges: [edge('ghost', 'S')], // ghost depends on S, but ghost has no CI row
      servicesByCi: new Map(),
      cisByService: new Map(),
    };
    const { service } = makeService(fakeProvider(w));
    const g = await service.assembleImpactGraph('t1', { type: 'ci', ref: 'S' });
    expect(g.resolved).toBe(true);
    expect(g.gaps).toContainEqual({
      scope: 'ci:S',
      missingInput: 'related_ci',
      degradedOutput: 'truncated_dependency_chain',
    });
  });

  it('names a blast-radius gap when an affected service has zero CI links', async () => {
    const w: World = {
      cis: new Map([['S', ci('S')]]),
      edges: [],
      servicesByCi: new Map([['S', [svc('svc1', 'rail_one')]]]),
      cisByService: new Map([['svc1', []]]), // service has no CIs
    };
    const { service } = makeService(fakeProvider(w));
    const g = await service.assembleImpactGraph('t1', { type: 'ci', ref: 'S' });
    expect(g.totalCustomers).toBeNull();
    expect(g.gaps).toContainEqual({
      scope: 'service:rail_one',
      missingInput: 'ci_links',
      degradedOutput: 'blast_radius_unavailable',
    });
  });

  it('serves a cache hit on the second identical traversal', async () => {
    const w: World = {
      cis: new Map([['S', ci('S')]]),
      edges: [],
      servicesByCi: new Map(),
      cisByService: new Map(),
    };
    const { service } = makeService(fakeProvider(w));
    const first = await service.assembleImpactGraph('t1', { type: 'ci', ref: 'S' });
    const second = await service.assembleImpactGraph('t1', { type: 'ci', ref: 'S' });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
  });

  it('keys the cache per-tenant (no cross-tenant hit)', async () => {
    const w: World = {
      cis: new Map([['S', ci('S')]]),
      edges: [],
      servicesByCi: new Map(),
      cisByService: new Map(),
    };
    const { service, redisStore } = makeService(fakeProvider(w));
    await service.assembleImpactGraph('tenant-A', { type: 'ci', ref: 'S' });
    const keys = [...redisStore.keys()];
    expect(keys.every((k) => k.includes('tenant-A'))).toBe(true);
    // a different tenant's key would not collide
    const other = await service.assembleImpactGraph('tenant-B', { type: 'ci', ref: 'S' });
    expect(other.cacheHit).toBe(false);
  });
});
