// W8 — AIOps reasoning types. THE DEFINING DECISION: deterministic structure
// (correlation / RCA ranking / classification / timeline / impact), LLM
// narration on top. Everything here is computed deterministically from the
// substrate + topology so it is reproducible, citable, and gradeable against
// the P2 golden outcomes. No banking literal (§6.6) — framing comes from the pack.

import type { TimeWindow } from '../datasource/data-source.types';

/** A correlated incident — N raw alerts collapsed to 1 by topology + time. */
export interface Incident {
  incidentId: string;
  window: { from: string; to: string };
  memberAlertRefs: string[]; // alert ids
  memberCiExternalIds: string[]; // distinct CIs that alerted
  rootCandidateCiRefs: string[]; // topology-derived root candidate(s)
  compressionRatio: string; // 'N:1'
  rawAlertCount: number;
  incidentCount: 1;
}

/** A ranked root-cause candidate (recent-change-weighted; deterministic score). */
export interface RankedCause {
  changeRef: string;
  ciExternalId: string;
  at: string;
  summary: string;
  proximity: number; // graph distance to the incident (0 = on root/member)
  recencyHours: number; // hours before incident onset (smaller = stronger)
  score: number;
  rank: number;
}

export type FailurePattern = 'site_or_power' | 'isp_or_link' | 'device' | 'indeterminate';
export type FailureScope = 'branch_local' | 'hub_cluster' | 'datacentre' | 'not_branch';

export interface BranchClassification {
  isBranchFailure: boolean;
  pattern: FailurePattern;
  scope: FailureScope;
  affectedBranchCount: number; // traversal-derived
  note: string;
}

export interface TimelineEntry {
  at: string;
  kind: 'change' | 'alert' | 'threshold';
  ref: string;
  ciExternalId: string | null;
  description: string;
}

/** Impact — REUSED from the Phase-2 traversal/§FROZEN, never re-stated. */
export interface IncidentImpact {
  rootCiExternalId: string | null;
  services: string[];
  customers: number | null;
  branches: number;
  /** D15-style class label for the customer figure (Class-1 measured / unavailable). */
  customersClass: 'measured' | 'unavailable';
}

export interface ContextGapRef {
  scope: string;
  missingInput: string;
  degradedOutput: string;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Confidence {
  level: ConfidenceLevel;
  /** 0..1 derived from grounding completeness. */
  score: number;
  reasons: string[];
}

/** Propose-not-execute — every W8 output is a draft a human attests/executes. */
export interface RecommendedAction {
  mode: 'propose';
  autoExecute: false;
  text: string;
}

/** Obligation-surfacing only (Assist) — never a definitive RBI determination. */
export interface ReportabilityAssessment {
  applicable: boolean;
  obligation: string | null;
  windowHours: number | null;
  authority: string | null;
  caveat: string; // the honest [verify] caveat
  verify: boolean; // true = specifics pending field validation
}

/** The full deterministic incident analysis — the gradeable structure. */
export interface IncidentAnalysis {
  scenario: string | null;
  incident: Incident;
  rankedCauses: RankedCause[];
  classification: BranchClassification | null;
  timeline: TimelineEntry[];
  impact: IncidentImpact;
  reportability: ReportabilityAssessment;
  confidence: Confidence;
  gaps: ContextGapRef[];
  recommendedAction: RecommendedAction;
  synthetic: string | null; // standing disclosure label
}

export interface AnalyzeWindowInput {
  tenantId: string;
  window: TimeWindow;
  packId?: string;
  scenario?: string | null;
}
