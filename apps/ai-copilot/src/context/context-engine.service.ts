import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSourceRegistry } from '../datasource/data-source.registry';
import { CmdbGraphService } from './cmdb-graph.service';
import { PackLoaderService } from '../packs/pack-loader.service';
import type { DataSourceProvider } from '../datasource/data-source-provider.interface';
import type {
  BusinessService,
  ConfigurationItem,
} from '../datasource/data-source.types';
import type { ValueModel } from '../packs/value-model.schema';
import type {
  BuildContextInput,
  Completeness,
  OperationalContext,
} from './operational-context.types';
import type { ContextGap, ImpactGraph } from './impact-graph.types';
import type { BusinessImpactBlock } from './business-impact.types';
import type { ApplicationPerformanceBlock } from './application-performance.types';
import { buildBusinessImpact } from './business-impact.builder';
import { buildApplicationPerformance } from './application-performance.builder';
import { composeGaps } from './degradation-matrix';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * W6 Context Engine. Phase 1 (CP6.1-6.2) produced the static cmdb_context block.
 * Phase 2 turns it into a reasoning surface: the CP6.3 graph traversal grounds
 * the D15 three-class business_impact block, the CP6.4 degradation matrix names
 * every gap, and the APM Tier-A block carries golden signals (honest empty-state
 * where the provider exposes none).
 *
 * D16 boundary (lint-checkable): this class reads foreign data ONLY through the
 * DataSourceRegistry → provider and the CmdbGraphService (which itself goes
 * through the provider). It contains no table SQL and no TypeORM repository, and
 * no banking literal (§6.6) — see test/context/*.spec.ts.
 */
@Injectable()
export class ContextEngine {
  private readonly logger = new Logger(ContextEngine.name);
  private readonly syntheticDataLabel: string | null;

  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly graph: CmdbGraphService,
    private readonly packs: PackLoaderService,
    private readonly config: ConfigService,
  ) {
    const label = this.config.get<string>('SYNTHETIC_DATA_LABEL', '');
    this.syntheticDataLabel = label && label.length > 0 ? label : null;
  }

  async buildContext(input: BuildContextInput): Promise<OperationalContext> {
    const started = Date.now();
    const { tenantId, entity } = input;
    const packId = input.packId ?? 'default';

    const combined = await this.registry.combinedCmdbCapabilities(tenantId);
    const provider = await this.registry.getCmdbProvider(tenantId);

    // Resolve the primary CI. Phase 1 supports entity.type === 'ci'. alert/asset
    // resolution needs the operational source (alert → asset → CI), still W6
    // Phase 2+; we surface that honestly rather than guess.
    let ci: ConfigurationItem | null = null;
    let note: string | undefined;
    if (provider && entity.type === 'ci') {
      ci = await this.resolveCi(provider, entity.ref, tenantId);
    } else if (provider && entity.type === 'alert') {
      // alertId → CI bridge: the provider resolves the alert to its bearing CI
      // (SynthBank p2_alerts now; EMS Core alerts API later), then the proven CI
      // path takes over. The CI read still flows only through the provider.
      const alert = await provider.getAlertById(entity.ref, tenantId);
      if (alert) {
        ci = await this.resolveCi(provider, alert.ciExternalId, tenantId);
        note = `alert '${entity.ref}' resolved to CI '${alert.ciExternalId}' (${alert.severity} on ${alert.metric}) via seeded p2_alerts; operational EMS Core alert source is a later W6 step.`;
      } else {
        note = `alert '${entity.ref}' not found in seeded p2_alerts; no CI resolvable.`;
      }
    } else if (entity.type !== 'ci') {
      note = `entity.type '${entity.type}' resolution requires the operational DataSource (later W6 step); only 'ci' and 'alert' are resolvable now.`;
    }

    if (!provider || !ci) {
      return this.absentContext(input, combined, started, note);
    }

    // Depth-1 neighbourhood for the cmdb_context display + recent changes.
    const [neighbourhood, recentChanges] = await Promise.all([
      provider.getCiRelationships(ci.id, 1, tenantId),
      provider.getCiChangeHistory(ci.id, this.lastDays(7), tenantId),
    ]);

    // CP6.3 impact graph (depth-bounded, cached) grounds the D15 fill.
    const impact: ImpactGraph = await this.graph.assembleImpactGraph(tenantId, {
      type: 'ci',
      ref: ci.id,
    });
    const services = impact.affectedServices;

    // CP6.5 value-model (pack) — the only assumptions D15 may declare.
    const valueModel = await this.loadValueModel(packId);

    // D15 — the three-class business_impact block.
    const businessImpact: BusinessImpactBlock = buildBusinessImpact(impact, {
      criticalityTier: this.escalateTier(ci, services),
      valueModel,
      syntheticDataLabel: this.syntheticDataLabel,
    });

    // APM Tier-A — golden signals for the CI + its impact set (honest empty-state
    // where the backing serves no telemetry; DR-mirror posture surfaced as a gap).
    const applicationPerformance: ApplicationPerformanceBlock =
      await buildApplicationPerformance(provider, ci, impact.dependencyChain, tenantId);

    const relCount = neighbourhood.upstream.length + neighbourhood.downstream.length;
    const completeness = this.computeCompleteness(ci, services, relCount);

    // CP6.4 — name every gap that degraded an output.
    const gaps: ContextGap[] = composeGaps({
      ci,
      services,
      relCount,
      impact,
      businessImpact,
      applicationPerformance,
    });

    return {
      primaryEntity: {
        type: entity.type,
        ref: entity.ref,
        id: ci.id,
        name: ci.name,
        criticalityTier: ci.criticalityTier,
      },
      cmdbContext: {
        configurationItem: ci,
        upstreamDependencies: neighbourhood.upstream,
        downstreamDependents: neighbourhood.downstream,
        businessServices: services,
        businessImpact,
        ownership: {
          technicalOwner: ci.technicalOwner,
          businessOwner: ci.businessOwner,
          operationsTeam: ci.operationsTeam,
        },
        recentChanges,
        completeness,
        gaps,
      },
      applicationPerformance,
      sourceAttribution: {
        cmdb: { provider: provider.name, type: provider.type },
        operational: null,
        combinedCmdbCapabilities: combined,
      },
      meta: { tenantId, buildMs: Date.now() - started, note },
    };
  }

  private async loadValueModel(packId: string): Promise<ValueModel | null> {
    try {
      const pack = await this.packs.getPack(packId);
      return pack.valueModel;
    } catch (err) {
      this.logger.warn(`value-model unavailable for pack '${packId}': ${(err as Error).message}`);
      return null;
    }
  }

  private async resolveCi(
    provider: DataSourceProvider,
    ref: string,
    tenantId: string,
  ): Promise<ConfigurationItem | null> {
    if (UUID_RE.test(ref)) {
      const byId = await provider.getConfigurationItem(ref, tenantId);
      if (byId) return byId;
    }
    return provider.findConfigurationItem(ref, tenantId);
  }

  /** Honest completeness from the entity's resolved data (not just capability). */
  private computeCompleteness(
    ci: ConfigurationItem,
    services: BusinessService[],
    relCount: number,
  ): Completeness {
    const hasServices = services.length > 0;
    const hasRels = relCount > 0;
    const hasOwner = !!(ci.technicalOwner || ci.businessOwner);
    const hasTier = ci.criticalityTier !== 'unknown';
    const signals = [hasServices, hasRels, hasOwner, hasTier].filter(Boolean).length;
    if (signals === 0) return 'minimal'; // CI exists but is isolated/unclassified
    if (hasServices && hasRels && hasOwner && hasTier) return 'full';
    return 'partial';
  }

  private escalateTier(ci: ConfigurationItem, services: BusinessService[]) {
    const order = { 'tier-1': 1, 'tier-2': 2, 'tier-3': 3, unknown: 4 } as const;
    let best = ci.criticalityTier;
    for (const s of services) {
      if (order[s.criticalityTier] < order[best]) best = s.criticalityTier;
    }
    return best;
  }

  private absentContext(
    input: BuildContextInput,
    combined: OperationalContext['sourceAttribution']['combinedCmdbCapabilities'],
    started: number,
    note?: string,
  ): OperationalContext {
    const gap: ContextGap = {
      scope: `${input.entity.type}:${input.entity.ref}`,
      missingInput: 'configuration_item',
      degradedOutput: 'context_unavailable',
    };
    const businessImpact: BusinessImpactBlock = {
      criticalityTier: 'unknown',
      affectedServiceNames: [],
      figures: [],
      syntheticDataLabel: this.syntheticDataLabel,
      gaps: [gap],
    };
    const applicationPerformance: ApplicationPerformanceBlock = {
      completeness: 'empty',
      signals: [],
      gaps: [gap],
      source: null,
      tierBSignals: [],
      apmCapabilities: { mode: 'seed', hasResponseTime: false, hasQueryTime: false, hasSuccessRate: false, hasErrorRate: false, hasAppAvailability: false, hasPercentiles: false, hasTraces: false },
    };
    return {
      primaryEntity: {
        type: input.entity.type,
        ref: input.entity.ref,
        id: null,
        name: null,
        criticalityTier: 'unknown',
      },
      cmdbContext: {
        configurationItem: null,
        upstreamDependencies: [],
        downstreamDependents: [],
        businessServices: [],
        businessImpact,
        ownership: { technicalOwner: null, businessOwner: null, operationsTeam: null },
        recentChanges: [],
        completeness: 'absent',
        gaps: [gap],
      },
      applicationPerformance,
      sourceAttribution: { cmdb: null, operational: null, combinedCmdbCapabilities: combined },
      meta: {
        tenantId: input.tenantId,
        buildMs: Date.now() - started,
        note: note ?? `no context resolvable for ${input.entity.type} '${input.entity.ref}'`,
      },
    };
  }

  private lastDays(days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from, to };
  }
}
