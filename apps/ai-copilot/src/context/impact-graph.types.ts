// W6 Phase 2 (CP6.3) — the assembled CMDB impact graph produced by
// CmdbGraphService. Vendor-neutral, no banking literal (§6.6): a "customer-
// bearing node" is any CI that carries a `customer_count` attribute, whatever
// the vertical calls it.

import type {
  BusinessService,
  CiRelationship,
  ConfigurationItem,
} from '../datasource/data-source.types';

/**
 * A named gap in the assembled context — the unit of honest degradation shared
 * by CP6.3 (partial graph) and CP6.4 (degradation matrix). `scope` identifies
 * what the gap is about, `missingInput` the absent grounding, `degradedOutput`
 * the capability that consequently can't be produced. Never a fabricated fill.
 */
export interface ContextGap {
  scope: string; // e.g. 'service:atm_card_services' | 'ci:CI-0042' | 'graph'
  missingInput: string; // e.g. 'ci_links' | 'customer_count' | 'criticality_tier'
  degradedOutput: string; // e.g. 'blast_radius_unavailable' | 'customers_affected_unavailable'
}

/** Traversal direction over the directed CI→CI dependency graph. */
export type TraversalDirection = 'downstream' | 'upstream';
// downstream = CIs that DEPEND ON the seed (impact/blast-radius; default).
// upstream   = CIs the seed DEPENDS ON (its own dependencies).

export interface GraphSeed {
  type: 'ci' | 'service';
  /** External id ('CI-0005'), exact name, or uuid for a CI; service id/name for a service. */
  ref: string;
}

/** A CI that carries a customer count — the leaf the blast radius reaches. */
export interface CustomerBearingNode {
  ciId: string;
  externalId: string | null;
  name: string;
  customerCount: number;
  /** Optional sub-type label carried from the spine (e.g. 'urban'|'standard'). */
  segment: string | null;
}

/**
 * The assembled impact graph: seed → affected services → CI→CI dependency chain
 * → customer-bearing nodes, with traversal metadata and named gaps. This is the
 * grounding substrate D15 turns into the business_impact block.
 */
export interface ImpactGraph {
  seed: {
    type: 'ci' | 'service';
    ref: string;
    id: string | null;
    externalId: string | null;
    name: string | null;
  };
  resolved: boolean; // false when the seed itself could not be resolved
  direction: TraversalDirection;
  maxDepth: number;
  depthReached: number;
  /** Services directly impacted by the seed (CI→service links). */
  affectedServices: BusinessService[];
  /** Distinct CIs reached by the CI→CI dependency-chain walk (excludes the seed). */
  dependencyChain: ConfigurationItem[];
  /** Distinct customer-bearing CIs reached via the affected services. */
  customerBearingNodes: CustomerBearingNode[];
  /** Deduped sum of customer counts across customerBearingNodes. */
  totalCustomers: number | null; // null = not grounded (no customer-bearing node found)
  /** Count of distinct customer-bearing nodes (e.g. branches). */
  affectedNodeCount: number;
  /** Edges traversed in the CI→CI walk. */
  edges: CiRelationship[];
  gaps: ContextGap[];
  cacheHit: boolean;
  /** Whether a cycle was encountered and safely cut by the visited-set. */
  cyclesCut: number;
}
