import type { PackManifest } from './pack.schema';
import type { ValueModel } from './value-model.schema';
import type { DashboardTemplate } from '../dashboard/dashboard-schema';

export interface PackSummary {
  industry: string;
  version: string;
  name: string;
  path: string;
}

export interface Pack extends PackSummary {
  description: string;
  glossary: unknown;
  severityRules: unknown;
  cmdbMappings: unknown;
  sopCategories: unknown;
  /**
   * W6 Phase 2 (CP6.5): the value-model coefficients (value-at-risk duration,
   * retention churn) the D15 fill resolves. Optional — a pack without a
   * value-model.yaml loads with valueModel=null and D15 degrades that figure to
   * a named gap rather than fabricating a coefficient.
   */
  valueModel: ValueModel | null;
  /**
   * W9 / CP9.3: the persona dashboard templates from dashboard-templates/*.yaml,
   * each validated against the Dashboard template schema at load (a malformed
   * template fails the pack loudly rather than shipping). May be empty.
   */
  dashboardTemplates: DashboardTemplate[];
}

export type { PackManifest };

export class PackNotFoundError extends Error {
  constructor(industry: string) {
    super(`Pack not found for industry "${industry}"`);
    this.name = 'PackNotFoundError';
  }
}

export class PackValidationError extends Error {
  public readonly issues: unknown[];
  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = 'PackValidationError';
    this.issues = issues;
  }
}
