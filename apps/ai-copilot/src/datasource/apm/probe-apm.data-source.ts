import { Injectable } from '@nestjs/common';
import type { ApmSource } from './apm-source.interface';
import type { ApmCapabilities, ServicePerformance } from '../data-source.types';

/**
 * ADR-006 probe-mode APM source — the PRODUCTION path, HONEST-STUB for now.
 *
 * The real synthetic-probe runner (outside-in scripted transactions against the
 * bank's actual endpoints) lands at client deployment, reusing the ems-api
 * probe runner. Until an endpoint is configured this stub returns
 * completeness:'absent' + all capability flags false and NEVER fabricates a
 * number — so probe mode is honest (preserves the 0-FLAG record) and the eventual
 * wiring is a drop-in (configure endpoints + keep APM_SOURCE=probe), not a rip-out.
 */
@Injectable()
export class ProbeApmDataSource implements ApmSource {
  readonly mode = 'probe' as const;

  async apmCapabilities(): Promise<ApmCapabilities> {
    // No probe endpoint configured yet → nothing is measurable. All false; honest.
    return {
      mode: 'probe',
      hasResponseTime: false,
      hasQueryTime: false,
      hasSuccessRate: false,
      hasErrorRate: false,
      hasAppAvailability: false,
      hasPercentiles: false,
      hasTraces: false,
    };
  }

  async getServicePerformance(ref: string): Promise<ServicePerformance> {
    return {
      ref,
      name: null,
      kind: 'ci',
      completeness: 'absent',
      signals: [],
      percentilesAvailable: false,
      note: 'APM_SOURCE=probe: no probe endpoint configured — real-probe wiring lands at client deployment (reuse ems-api probe runner). No numbers fabricated.',
      source: { provider: 'synthetic_probe', mode: 'probe' },
    };
  }
}
