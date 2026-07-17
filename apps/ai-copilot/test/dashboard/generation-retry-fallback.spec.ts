// CP9.4.3 — deterministic proof of the validate → one-retry → fallback loop, with a
// mocked gateway (the live LLM is non-deterministic; the control flow must be proven
// deterministically). Confirms: a first-attempt failure retries with the errors fed
// back; a double failure falls back to the nearest persona template; every attempt
// is logged.

import { DashboardGenerationService } from '../../src/dashboard/dashboard-generation.service';
import { DashboardTemplateSchema, type DashboardTemplate } from '../../src/dashboard/dashboard-schema';

const TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const SAFETY = { injectionDetected: false, injectionFindings: [], maskedSecretCount: 0 };

const tmpl = (key: string, persona: string, type: string): DashboardTemplate =>
  DashboardTemplateSchema.parse({
    schemaVersion: 1, key, title: `T-${key}`, persona,
    layout: { grid: { cols: 12 }, items: [{ widgetId: 'a', x: 0, y: 0, w: 4, h: 4 }] },
    widgets: [{ id: 'a', type, title: 'W', requiredDataClasses: ['alerts'], query: { dataClass: 'alerts' } }],
    generatedBy: 'template',
  });

function makeService() {
  const gateway = { completeStructured: jest.fn() };
  const capability = { availableDataClasses: jest.fn().mockResolvedValue(new Set(['alerts', 'cmdb_ci'])) };
  const packs = { getPack: jest.fn().mockResolvedValue({ dashboardTemplates: [tmpl('ceo-x', 'ceo', 'kpi_tile'), tmpl('noc-x', 'noc', 'alert_list')] }) };
  const persistence = { logGeneration: jest.fn().mockResolvedValue('log-1') };
  const svc = new DashboardGenerationService(gateway as never, capability as never, packs as never, persistence as never);
  return { svc, gateway, persistence };
}

const fail = (auditId: string) => ({ ok: false, value: null, issues: [{ message: 'bad widget config' }], raw: '{"broken":true}', auditId, costUsd: 0, model: 'claude-sonnet-4-6', safety: SAFETY, budgetBlocked: false });
const pass = (value: DashboardTemplate, auditId: string) => ({ ok: true, value, issues: [], raw: JSON.stringify(value), auditId, costUsd: 0.01, model: 'claude-sonnet-4-6', safety: SAFETY, budgetBlocked: false });

describe('DashboardGenerationService — retry + fallback', () => {
  it('retries once with errors fed back, then succeeds (fallbackUsed=false)', async () => {
    const { svc, gateway, persistence } = makeService();
    const good = tmpl('gen-ok', 'noc', 'alert_list');
    gateway.completeStructured.mockResolvedValueOnce(fail('a1')).mockResolvedValueOnce(pass(good, 'a2'));

    const r = await svc.generate('real-time infrastructure dashboard', TENANT);

    expect(gateway.completeStructured).toHaveBeenCalledTimes(2); // one retry
    expect(r.fallbackUsed).toBe(false);
    expect(r.proposal.tenantId).toBe(TENANT); // materialised
    expect(r.proposal.key).toBe('gen-ok');
    // the retry prompt fed the validation errors back to the model
    expect(gateway.completeStructured.mock.calls[1][0].prompt).toContain('FAILED validation');
    // logged with both attempts captured
    const logArg = persistence.logGeneration.mock.calls[0][0];
    expect(logArg.validationErrors).toHaveLength(2);
    expect(r.generationLogId).toBe('log-1');
  });

  it('double failure falls back to the nearest persona template (fallbackUsed=true)', async () => {
    const { svc, gateway, persistence } = makeService();
    gateway.completeStructured.mockResolvedValue(fail('a1'));

    const r = await svc.generate('executive overview for the MD and the board', TENANT);

    expect(gateway.completeStructured).toHaveBeenCalledTimes(2);
    expect(r.fallbackUsed).toBe(true);
    expect(r.proposal.persona).toBe('ceo'); // nearest template by keyword
    expect(r.proposal.tenantId).toBe(TENANT);
    const logArg = persistence.logGeneration.mock.calls[0][0];
    expect(JSON.stringify(logArg.validationErrors)).toContain('fallbackUsed');
  });
});
