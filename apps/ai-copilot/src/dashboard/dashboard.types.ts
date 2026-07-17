// W9 — Dashboards + the CEO/board layer. Deterministic classed tiles + a bounded
// executive narrative. THE GOVERNING CONSTRAINT: no number without its ADR-005
// class + grounding, and the narrative contains no number not in a tile. The
// classed `Figure` is REUSED from D15 (same honesty contract). No banking literal.

import type { Figure } from '../context/business-impact.types';
import type { ContextGap } from '../context/impact-graph.types';

export type { Figure };

export type TileStatus = 'ok' | 'partial' | 'empty';

/** A board/dashboard tile — deterministic data; every number lives in `figures`. */
export interface Tile {
  id: string;
  title: string;
  status: TileStatus;
  figures: Figure[];
  /** Human notes (NO bare numbers — narrative/figures carry numbers). */
  notes: string[];
  gaps: ContextGap[];
  /** Standing synthetic-data disclosure, or null in a real deployment. */
  label: string | null;
}

export type DigestSectionKey =
  | 'risk_now'
  | 'value_realized'
  | 'compliance'
  | 'cost'
  | 'bcp_dr'
  | 'trend';

export interface DigestSection {
  key: DigestSectionKey;
  title: string;
  tiles: Tile[];
}

export interface BoardDigestNarrative {
  content: string;
  grounded: boolean;
  declined: boolean;
  evidenceRefs: string[];
  model: string | null;
}

export interface BoardDigest {
  tenantId: string;
  period: string;
  sections: DigestSection[];
  narrative: BoardDigestNarrative | null;
  label: string | null;
}
