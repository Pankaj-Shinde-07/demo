// W8 (CP8.5) — reportability is OBLIGATION-SURFACING ONLY (Assist), never a
// definitive determination (T-REGULATORY-ASSERT). The mechanism reads the pack's
// regulatory rules; the actual specifics stay [verify]-pending field validation.
// No regulatory literal in this engine code — it all comes from the pack.

import type { ReportabilityAssessment } from './incident.types';

interface PackRegulatory {
  regulator?: string;
  framework?: string;
  incident_reporting?: string;
  report_window_hours?: number; // structured override if a pack supplies one
}

export interface ReportabilitySignals {
  customerImpacting: boolean; // tier-1 / measured customer impact
  securityIncident: boolean;
}

/**
 * Surface the obligation + clock from the pack's regulatory rules WHEN the
 * incident plausibly triggers one (customer-impacting or security). Always with
 * the honest [verify] caveat; never a fixed determination.
 */
export function assessReportability(
  packRegulatory: PackRegulatory | null | undefined,
  signals: ReportabilitySignals,
): ReportabilityAssessment {
  if (!packRegulatory || (!packRegulatory.incident_reporting && !packRegulatory.framework)) {
    return {
      applicable: false,
      obligation: null,
      windowHours: null,
      authority: null,
      caveat: 'No regulatory rules configured in the active pack; reportability not assessed.',
      verify: true,
    };
  }
  if (!signals.customerImpacting && !signals.securityIncident) {
    return {
      applicable: false,
      obligation: null,
      windowHours: null,
      authority: packRegulatory.regulator ?? null,
      caveat: 'Incident does not appear customer-impacting or security-related; confirm against the pack rules.',
      verify: true,
    };
  }
  return {
    applicable: true,
    obligation:
      packRegulatory.incident_reporting ??
      `Possible reporting obligation under ${packRegulatory.framework}`,
    windowHours: packRegulatory.report_window_hours ?? null,
    authority: packRegulatory.regulator ?? null,
    // The honest caveat — Assist, not a determination.
    caveat:
      'This MAY be reportable per the pack rule — confirm the obligation and the exact window with the current regulator circular ([verify]). This is assistance, not a determination.',
    verify: true,
  };
}
