// The structured operational context the W6 engine produces (plan lines 342-376).
// W7 generation consumes this; the `completeness` flag drives prompt construction.
//
// Phase 1 populates primary_entity + cmdb_context + source_attribution for a CI.
// Two blocks are typed-but-empty skeleton hooks, to be filled in W6 Phase 2:
//   - business_impact.revenueAtRiskHourly  → D15 three-class model (ADR-005, T2)
//   - applicationPerformance               → APM Tier-A golden signals (ADR-004, T3)

import type {
  BusinessService,
  ChangeRecord,
  ConfigurationItem,
  CriticalityTier,
  OwnerIdentity,
} from '../datasource/data-source.types';
import type { CmdbCapabilities } from '../datasource/data-source-provider.interface';
import type { BusinessImpactBlock } from './business-impact.types';
import type { ContextGap } from './impact-graph.types';
import type { ApplicationPerformanceBlock } from './application-performance.types';

export type Completeness = 'full' | 'partial' | 'minimal' | 'absent';

export interface Ownership {
  technicalOwner: OwnerIdentity | null;
  businessOwner: OwnerIdentity | null;
  operationsTeam: string | null;
}

export interface CmdbContext {
  configurationItem: ConfigurationItem | null;
  upstreamDependencies: ConfigurationItem[];
  downstreamDependents: ConfigurationItem[];
  businessServices: BusinessService[];
  /** D15 (ADR-005): the structured three-class business_impact block. */
  businessImpact: BusinessImpactBlock;
  ownership: Ownership;
  recentChanges: ChangeRecord[];
  completeness: Completeness;
  /**
   * CP6.4 degradation matrix: named gaps {scope, missingInput, degradedOutput}
   * for every missing input that degraded an output. Additive to the Phase-1
   * `completeness` flag — degrade-don't-fabricate made structural.
   */
  gaps: ContextGap[];
}

export interface SourceAttribution {
  /** Provider that supplied the cmdb_context block (null when none available). */
  cmdb: { provider: string; type: string } | null;
  /** Operational facts (assets/alerts/metrics) — EMS Core API, W6 Phase 2. */
  operational: null;
  /** Union of CMDB capabilities across the tenant's registered providers. */
  combinedCmdbCapabilities: CmdbCapabilities;
}

export interface PrimaryEntity {
  type: 'ci' | 'alert' | 'asset';
  /** The reference the caller passed (external id, name, or uuid). */
  ref: string;
  id: string | null;
  name: string | null;
  criticalityTier: CriticalityTier;
}

export interface OperationalContext {
  primaryEntity: PrimaryEntity;
  cmdbContext: CmdbContext;
  /** APM Tier-A golden signals block (always present; honest empty-state when
   *  the provider exposes no telemetry — see application-performance.types). */
  applicationPerformance: ApplicationPerformanceBlock;
  sourceAttribution: SourceAttribution;
  meta: {
    tenantId: string;
    buildMs: number;
    note?: string;
  };
}

export interface BuildContextInput {
  tenantId: string;
  entity: {
    type: 'ci' | 'alert' | 'asset';
    /** External id ('CI-0001'), exact CI name, or CI uuid. */
    ref: string;
  };
  /**
   * Industry pack whose value-model grounds the D15 fill (CP6.5). Defaults to
   * 'default' (generic). The caller passes 'banking' for the SynthBank canary.
   */
  packId?: string;
}
