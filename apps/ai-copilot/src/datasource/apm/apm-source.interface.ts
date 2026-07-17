import type { ApmCapabilities, ServicePerformance } from '../data-source.types';

/**
 * ADR-006 — the APM source behind the `APM_SOURCE` switch. One interface, two
 * implementations selected by the env flag:
 *   - seed  (demo): labeled-synthetic SynthBank Tier-B — real now.
 *   - probe (prod): the real synthetic-probe runner against the bank's endpoints
 *                   — honest-stub until wired at client deployment (reuse the
 *                   ems-api probe runner). With no endpoint configured it
 *                   returns completeness:'absent' and NEVER invents numbers.
 * The native DataSourceProvider delegates getServicePerformance/apmCapabilities
 * to whichever ApmSource is bound — the demo→production switch is a drop-in.
 */
export const APM_SOURCE = Symbol('APM_SOURCE');

export interface ApmSource {
  readonly mode: 'seed' | 'probe';
  apmCapabilities(tenantId: string): Promise<ApmCapabilities>;
  getServicePerformance(ref: string, tenantId: string): Promise<ServicePerformance>;
}
