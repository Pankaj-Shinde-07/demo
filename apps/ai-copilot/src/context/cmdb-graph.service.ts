import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/redis.module';
import { DataSourceRegistry } from '../datasource/data-source.registry';
import type { DataSourceProvider } from '../datasource/data-source-provider.interface';
import type {
  BusinessService,
  CiRelationship,
  ConfigurationItem,
} from '../datasource/data-source.types';
import type {
  ContextGap,
  CustomerBearingNode,
  GraphSeed,
  ImpactGraph,
  TraversalDirection,
} from './impact-graph.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_PREFIX = 'cmdbgraph:v1';

/**
 * W6 Phase 2 (CP6.3) — CMDB graph traversal + Redis read-through cache.
 *
 * Given a seed (a CI or a service) it assembles the impact graph:
 *   seed → affected services (CI→service links)
 *        → CI→CI dependency chain (directional, depth-bounded, cycle-safe)
 *        → customer-bearing nodes (CIs carrying a customer_count, via the
 *          affected services) for blast-radius counting.
 *
 * D16 boundary: every CMDB read goes through the DataSourceProvider (resolved
 * from the registry). This service issues NO `cmdb_` SQL and injects no TypeORM
 * repository — see test/context/no-direct-table-read.spec.ts (extended to cover
 * this file). Redis is a cache, not a table.
 *
 * Tenant isolation: tenantId threads through every provider call AND is the
 * first discriminator in every cache key — a cross-tenant cache hit is
 * structurally impossible (T-CACHE-STALE).
 */
@Injectable()
export class CmdbGraphService {
  private readonly logger = new Logger(CmdbGraphService.name);
  private readonly defaultMaxDepth: number;
  private readonly cacheTtl: number;

  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.defaultMaxDepth = this.config.get<number>('CMDB_GRAPH_MAX_DEPTH', 6);
    this.cacheTtl = this.config.get<number>('CMDB_GRAPH_CACHE_TTL_SECONDS', 300);
  }

  /**
   * Assemble the impact graph for a seed, read-through cached. A Redis outage or
   * a deliberately-broken spine degrades the result honestly (named gaps); it
   * never throws and never serves a cross-tenant or fabricated answer.
   */
  async assembleImpactGraph(
    tenantId: string,
    seed: GraphSeed,
    opts: { direction?: TraversalDirection; maxDepth?: number } = {},
  ): Promise<ImpactGraph> {
    const direction: TraversalDirection = opts.direction ?? 'downstream';
    const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? this.defaultMaxDepth, 32));

    const provider = await this.registry.getCmdbProvider(tenantId);
    if (!provider) {
      return this.unresolved(seed, direction, maxDepth, [
        { scope: 'graph', missingInput: 'datasource_provider', degradedOutput: 'impact_graph_unavailable' },
      ]);
    }

    // Resolve the seed to a canonical id first so the cache key is stable across
    // ref/uuid/name spellings of the same seed.
    const resolved = await this.resolveSeed(provider, seed, tenantId);
    if (!resolved) {
      return this.unresolved(seed, direction, maxDepth, [
        { scope: `${seed.type}:${seed.ref}`, missingInput: 'seed_entity', degradedOutput: 'impact_graph_unavailable' },
      ]);
    }

    const cacheKey = `${CACHE_PREFIX}:${tenantId}:${seed.type}:${resolved.id}:${direction}:${maxDepth}`;
    const cached = await this.cacheGet(cacheKey);
    if (cached) return { ...cached, cacheHit: true };

    const graph = await this.compute(provider, tenantId, seed, resolved, direction, maxDepth);
    await this.cacheSet(cacheKey, graph);
    return graph;
  }

  // ── core traversal ──────────────────────────────────────────────────────────

  private async compute(
    provider: DataSourceProvider,
    tenantId: string,
    seed: GraphSeed,
    resolved: { id: string; externalId: string | null; name: string; ci: ConfigurationItem | null },
    direction: TraversalDirection,
    maxDepth: number,
  ): Promise<ImpactGraph> {
    const gaps: ContextGap[] = [];

    // 1) Affected services.
    const affectedServices: BusinessService[] =
      seed.type === 'ci'
        ? await provider.getServicesAffectedByCi(resolved.id, tenantId)
        : await this.serviceAsList(provider, resolved.id, tenantId);

    // 2) CI→CI dependency chain (only when the seed is a CI).
    const chain: ConfigurationItem[] = [];
    const edges: CiRelationship[] = [];
    let depthReached = 0;
    let cyclesCut = 0;

    if (seed.type === 'ci') {
      const visited = new Set<string>([resolved.id]);
      let frontier: string[] = [resolved.id];
      for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: string[] = [];
        for (const ciId of frontier) {
          const graph = await provider.getCiRelationships(ciId, 1, tenantId);
          edges.push(...graph.edges);

          // Partial-graph honesty: an edge whose neighbour CI did not resolve is
          // a dangling edge → named gap (never silently dropped).
          const resolvedNeighbourIds = new Set([
            ...graph.upstream.map((c) => c.id),
            ...graph.downstream.map((c) => c.id),
          ]);
          for (const e of graph.edges) {
            const neighbour = e.sourceCiId === ciId ? e.targetCiId : e.sourceCiId;
            if (neighbour !== ciId && !resolvedNeighbourIds.has(neighbour)) {
              gaps.push({
                scope: `ci:${ciId}`,
                missingInput: 'related_ci',
                degradedOutput: 'truncated_dependency_chain',
              });
            }
          }

          const neighbours =
            direction === 'downstream' ? graph.downstream : graph.upstream;
          for (const n of neighbours) {
            if (visited.has(n.id)) {
              cyclesCut++; // already seen — a cycle/diamond; do not re-expand.
              continue;
            }
            visited.add(n.id);
            chain.push(n);
            next.push(n.id);
          }
        }
        if (next.length > 0) depthReached = depth;
        frontier = next;
      }
    }

    // 3) Customer blast radius — DIRECTIONAL discrimination (telemetry-seed §9.1):
    //   - a customer-bearing seed (e.g. a branch) is a LEAF consumer: its failure
    //     scopes to ITS OWN customers (+ any downstream customer-bearing nodes),
    //     NOT estate-wide — a branch-local incident ≠ a shared-rail incident.
    //   - a non-customer-bearing seed (infrastructure the services depend on)
    //     cascades to the consumers of the services it provides (the full rail).
    const customerNodes = new Map<string, CustomerBearingNode>();
    const addNode = (ci: ConfigurationItem) => {
      const count = this.customerCount(ci);
      if (count === null) return; // not a customer-bearing node
      if (!customerNodes.has(ci.id)) {
        customerNodes.set(ci.id, {
          ciId: ci.id,
          externalId: ci.externalId,
          name: ci.name,
          customerCount: count,
          segment: this.segment(ci),
        });
      }
    };

    const seedIsCustomerBearing =
      resolved.ci !== null && this.customerCount(resolved.ci) !== null;
    if (resolved.ci) addNode(resolved.ci); // the seed itself, if customer-bearing
    for (const c of chain) addNode(c); // downstream customer-bearing dependents

    let anyServiceHadLinks = false;
    if (!seedIsCustomerBearing) {
      // Provider/infrastructure seed → expand to the consumers of its services.
      for (const svc of affectedServices) {
        const cis = await provider.getCisForService(svc.id, tenantId);
        if (cis.length === 0) {
          gaps.push({
            scope: `service:${svc.name}`,
            missingInput: 'ci_links',
            degradedOutput: 'blast_radius_unavailable',
          });
          continue;
        }
        anyServiceHadLinks = true;
        for (const ci of cis) addNode(ci);
      }
    } else {
      anyServiceHadLinks = true; // leaf seed: its own count is the grounded radius
    }

    const customerBearingNodes = [...customerNodes.values()];
    const totalCustomers =
      customerBearingNodes.length > 0
        ? customerBearingNodes.reduce((s, n) => s + n.customerCount, 0)
        : null;

    if (totalCustomers === null) {
      // No customer-bearing node reached. Distinguish "services had CIs but none
      // carry customer counts" from "no service links at all" (already gapped).
      if (anyServiceHadLinks || affectedServices.length === 0) {
        gaps.push({
          scope: 'graph',
          missingInput: 'customer_count',
          degradedOutput: 'customers_affected_unavailable',
        });
      }
    }

    return {
      seed: {
        type: seed.type,
        ref: seed.ref,
        id: resolved.id,
        externalId: resolved.externalId,
        name: resolved.name,
      },
      resolved: true,
      direction,
      maxDepth,
      depthReached,
      affectedServices,
      dependencyChain: chain,
      customerBearingNodes,
      totalCustomers,
      affectedNodeCount: customerBearingNodes.length,
      edges,
      gaps: this.dedupeGaps(gaps),
      cacheHit: false,
      cyclesCut,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async resolveSeed(
    provider: DataSourceProvider,
    seed: GraphSeed,
    tenantId: string,
  ): Promise<{ id: string; externalId: string | null; name: string; ci: ConfigurationItem | null } | null> {
    if (seed.type === 'ci') {
      let ci: ConfigurationItem | null = null;
      if (UUID_RE.test(seed.ref)) ci = await provider.getConfigurationItem(seed.ref, tenantId);
      if (!ci) ci = await provider.findConfigurationItem(seed.ref, tenantId);
      return ci ? { id: ci.id, externalId: ci.externalId, name: ci.name, ci } : null;
    }
    // service seed: resolve by id (uuid) — name-based service resolution is not
    // in the provider interface, so we accept a uuid ref for services.
    if (UUID_RE.test(seed.ref)) {
      const svc = await provider.getBusinessService(seed.ref, tenantId);
      if (svc) return { id: svc.id, externalId: null, name: svc.name, ci: null };
    }
    return null;
  }

  private async serviceAsList(
    provider: DataSourceProvider,
    serviceId: string,
    tenantId: string,
  ): Promise<BusinessService[]> {
    const svc = await provider.getBusinessService(serviceId, tenantId);
    return svc ? [svc] : [];
  }

  /** Parse a CI's customer count from the spine attributes; null if absent/invalid. */
  private customerCount(ci: ConfigurationItem): number | null {
    const raw = ci.attributes?.['customer_count'];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private segment(ci: ConfigurationItem): string | null {
    const raw = ci.attributes?.['branch_type'] ?? ci.attributes?.['segment'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }

  private dedupeGaps(gaps: ContextGap[]): ContextGap[] {
    const seen = new Set<string>();
    const out: ContextGap[] = [];
    for (const g of gaps) {
      const k = `${g.scope}|${g.missingInput}|${g.degradedOutput}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(g);
    }
    return out;
  }

  private unresolved(
    seed: GraphSeed,
    direction: TraversalDirection,
    maxDepth: number,
    gaps: ContextGap[],
  ): ImpactGraph {
    return {
      seed: { type: seed.type, ref: seed.ref, id: null, externalId: null, name: null },
      resolved: false,
      direction,
      maxDepth,
      depthReached: 0,
      affectedServices: [],
      dependencyChain: [],
      customerBearingNodes: [],
      totalCustomers: null,
      affectedNodeCount: 0,
      edges: [],
      gaps,
      cacheHit: false,
      cyclesCut: 0,
    };
  }

  // ── cache (best-effort; never throws into the request path) ──────────────────

  private async cacheGet(key: string): Promise<ImpactGraph | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as ImpactGraph) : null;
    } catch (err) {
      this.logger.warn(`cache read miss-by-error for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  private async cacheSet(key: string, graph: ImpactGraph): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify({ ...graph, cacheHit: false }), 'EX', this.cacheTtl);
    } catch (err) {
      this.logger.warn(`cache write skipped for ${key}: ${(err as Error).message}`);
    }
  }
}
