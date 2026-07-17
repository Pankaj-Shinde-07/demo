// W9 / CP9.2 (D4) — THE SECURITY GATE. Proves the property the whole checkpoint
// exists to protect: no DSL value ever reaches SQL un-parameterised, and the DSL has
// no free-text-to-query leaf. Adversarial payloads are driven into every value-bearing
// leaf (scope.ref, filter.value) and into the field/identifier leaves; we assert they
// are either bound params / discrete provider args, or rejected by the schema — and
// that they NEVER alter the compiled SQL structure.

import { WidgetQuerySchema, type WidgetQueryInput } from '../widget-query.schema';
import { compileWidgetQuery, type ResolvedPlan } from '../compiler';

const PAYLOADS = [
  "' OR 1=1 --",
  "'; DROP TABLE knowledge_documents; --",
  "' UNION SELECT prompt FROM ai_audit_log --",
  '1); DELETE FROM tenants WHERE (1=1',
  '${process.env.DATABASE_PASSWORD}',
  '`rm -rf /`',
  'x" OR "1"="1',
];

const compileInput = (q: WidgetQueryInput): ResolvedPlan => {
  const parsed = WidgetQuerySchema.safeParse(q);
  if (!parsed.success) throw new Error('schema rejected: ' + parsed.error.issues.map((i) => i.message).join('; '));
  return compileWidgetQuery(parsed.data);
};

describe('DSL compiler — no raw SQL, ever', () => {
  describe('copilot SQL path: adversarial filter VALUES are bound params', () => {
    for (const payload of PAYLOADS) {
      it(`binds eq value: ${payload}`, () => {
        const plan = compileInput({
          source: 'copilot',
          copilotTable: 'knowledge_documents',
          filters: [{ field: 'document_type', op: 'eq', value: payload }],
        });
        expect(plan.kind).toBe('sql');
        if (plan.kind !== 'sql') return;
        // The compiled text carries ONLY placeholders + whitelisted identifiers —
        // never a quote, never the payload.
        expect(plan.text).not.toContain("'");
        expect(plan.text).not.toContain(payload);
        expect(plan.text).toBe(
          'SELECT count(*) AS n FROM knowledge_documents WHERE tenant_id = $1 AND document_type = $2',
        );
        expect(plan.params).toEqual([payload]); // the value lives in params, bound at $2
      });

      it(`binds contains value (wrapping % onto the bound param): ${payload}`, () => {
        const plan = compileInput({
          source: 'copilot',
          copilotTable: 'knowledge_documents',
          filters: [{ field: 'document_type', op: 'contains', value: payload }],
        });
        expect(plan.kind).toBe('sql');
        if (plan.kind !== 'sql') return;
        expect(plan.text).toContain('document_type ILIKE $2');
        expect(plan.text).not.toContain(payload);
        expect(plan.params).toEqual([`%${payload}%`]);
      });
    }
  });

  describe('field / identifier leaves cannot carry SQL', () => {
    it('rejects a filter field that is not a bare identifier (schema)', () => {
      const parsed = WidgetQuerySchema.safeParse({
        source: 'copilot',
        copilotTable: 'knowledge_documents',
        filters: [{ field: 'document_type; DROP TABLE x', op: 'eq', value: 'a' }],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects a quoted/space-bearing field at the schema layer', () => {
      for (const bad of ["doc'type", 'doc type', 'doc--type', '1; SELECT', 'DROP TABLE']) {
        const parsed = WidgetQuerySchema.safeParse({
          dataClass: 'cmdb_ci',
          filters: [{ field: bad, op: 'eq', value: 'a' }],
        });
        expect(parsed.success).toBe(false);
      }
    });

    it('a valid-identifier but NON-whitelisted column → not_resolvable (never SQL)', () => {
      const plan = compileInput({
        source: 'copilot',
        copilotTable: 'knowledge_documents',
        filters: [{ field: 'source_hash', op: 'eq', value: 'a' }], // real column, not queryable
      });
      expect(plan.kind).toBe('not_resolvable');
    });
  });

  describe('provider path: adversarial refs/values are discrete typed args, not SQL', () => {
    it('scope.ref carrying a payload becomes a discrete provider arg (no text)', () => {
      for (const payload of PAYLOADS) {
        const plan = compileInput({ dataClass: 'cmdb_relationships', scope: { level: 'ci', ref: payload } });
        expect(plan.kind).toBe('provider_call');
        if (plan.kind !== 'provider_call') continue;
        expect(plan).not.toHaveProperty('text'); // structurally cannot hold SQL
        expect(plan.method).toBe('getCiRelationships');
        expect(plan.args).toEqual([{ ref: payload, depth: 1 }]); // carried as data
      }
    });

    it('cmdb_ci name filter value rides in a typed CiQuery (provider binds it)', () => {
      const payload = "' OR 1=1 --";
      const plan = compileInput({ dataClass: 'cmdb_ci', filters: [{ field: 'name', op: 'contains', value: payload }] });
      expect(plan.kind).toBe('provider_call');
      if (plan.kind !== 'provider_call') return;
      expect(plan).not.toHaveProperty('text');
      expect(plan.method).toBe('searchConfigurationItems');
      expect(plan.args).toEqual([{ nameContains: payload }]);
    });
  });

  describe('global invariant: across a battery, no sql plan inlines any value', () => {
    it('every sql plan keeps params out of text; provider plans carry no text', () => {
      const battery: WidgetQueryInput[] = [];
      for (const payload of PAYLOADS) {
        battery.push({ source: 'copilot', copilotTable: 'ai_audit_log', filters: [{ field: 'model', op: 'eq', value: payload }] });
        battery.push({ source: 'copilot', copilotTable: 'knowledge_documents', field: 'document_type', aggregation: 'count', filters: [{ field: 'ingestion_status', op: 'eq', value: payload }], topN: 5 });
        battery.push({ dataClass: 'alerts', window: '7d', filters: [{ field: 'severity', op: 'eq', value: payload }] });
        battery.push({ dataClass: 'cmdb_ci', scope: { level: 'ci', ref: payload } });
      }
      for (const q of battery) {
        const plan = compileInput(q);
        if (plan.kind === 'sql') {
          // No bound value (as a raw substring) appears in the SQL text.
          for (const param of plan.params) {
            if (typeof param === 'string') expect(plan.text).not.toContain(param);
          }
          // Only $-placeholders carry values; no stray quotes in the structure.
          expect(plan.text).not.toContain("'");
          // Placeholder count matches the params count.
          const placeholders = (plan.text.match(/\$\d+/g) ?? []).length;
          expect(placeholders).toBe(plan.params.length + 1); // +1 for tenant_id ($1)
        } else if (plan.kind === 'provider_call') {
          expect(plan).not.toHaveProperty('text');
        }
        // not_resolvable is always safe (no read emitted).
      }
    });
  });
});
