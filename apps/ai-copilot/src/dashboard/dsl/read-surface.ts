// W9 / CP9.2 — the read-surface map the compiler consults (mirrors
// docs/ai-copilot/W9_READ_SURFACE.md). A class with no `live` read compiles to
// `not_resolvable` (→ honest empty state), never to a stub that returns a value (P2).
//
// Field + column WHITELISTS are the second safety layer under the identifier regex:
// even a syntactically-valid identifier is rejected unless it is a known field for
// the class / a known column for the Copilot-owned table. So a query can never name
// a column the schema doesn't have, let alone inject one.

import type { DataClass } from '../widget-catalogue';
import type { CopilotTable } from './widget-query.schema';

export type ReadStatus = 'live' | 'stubbed' | 'none';

export const READ_SURFACE: Record<DataClass, ReadStatus> = {
  cmdb_ci: 'live',
  cmdb_relationships: 'live',
  business_services: 'live',
  change_history: 'live',
  topology: 'live',
  metrics: 'live',
  alerts: 'live',
  incidents: 'stubbed', // no countable incident store wired (ITSM/EMS Core foreign + unwired); gate is false so this never compiles
  asset_status: 'live', // CP9.3a — CI golden-signal availability_state (up/degraded/down)
  security_events: 'none',
  vulnerabilities: 'none',
  threat_intel: 'none',
  compliance_controls: 'none',
  patch_status: 'none',
};

/** Allowed `field` / `filter.field` names per data class (provider path). */
export const FIELD_WHITELIST: Record<DataClass, string[]> = {
  cmdb_ci: ['ci_type', 'criticality_tier', 'name'],
  cmdb_relationships: ['relationship_type'],
  topology: ['relationship_type'],
  business_services: ['criticality_tier', 'name'],
  change_history: ['change_type', 'risk'],
  metrics: ['cpu_saturation_pct', 'memory_saturation_pct', 'latency_ms', 'availability_state', 'primary_metric'],
  alerts: ['severity', 'metric', 'scenario'],
  incidents: [],
  asset_status: ['availability_state', 'criticality_tier', 'ci_type'],
  security_events: [],
  vulnerabilities: [],
  threat_intel: [],
  compliance_controls: [],
  patch_status: [],
};

/** Allowed filter columns per Copilot-owned table (sql path). Verified against the
 *  live schema. The table name itself is an enum (CopilotTableEnum) so it can never
 *  be attacker-controlled; only these columns may appear in a WHERE clause. */
export const COPILOT_TABLE_COLUMNS: Record<CopilotTable, string[]> = {
  knowledge_documents: ['document_type', 'ingestion_status'],
  ai_audit_log: ['feature', 'model', 'provider'],
  ai_dashboard_generation_logs: ['model_used'],
};

export function isLive(dc: DataClass): boolean {
  return READ_SURFACE[dc] === 'live';
}
