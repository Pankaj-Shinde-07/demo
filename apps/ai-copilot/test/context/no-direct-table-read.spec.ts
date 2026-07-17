import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D16 boundary lint (plan W6 "No direct EMS table read in ContextEngine code —
 * enforced by lint rule"). The Context Engine must reach CMDB data ONLY through
 * the DataSourceProvider/registry. This test fails if any context/* source file
 * issues raw cmdb_ SQL, injects a TypeORM Repository/DataSource, or otherwise
 * bypasses the provider layer.
 */
describe('D16 boundary — ContextEngine does not read tables directly', () => {
  const contextDir = join(__dirname, '..', '..', 'src', 'context');
  const files = readdirSync(contextDir).filter((f) => f.endsWith('.ts'));

  it('finds the context source files', () => {
    expect(files).toContain('context-engine.service.ts');
  });

  const forbidden: Array<{ label: string; re: RegExp }> = [
    { label: 'raw cmdb_ table reference', re: /\bcmdb_[a-z_]+/ },
    { label: 'TypeORM DataSource import', re: /from\s+['"]typeorm['"]/ },
    { label: 'InjectRepository', re: /InjectRepository/ },
    { label: 'getRepository', re: /getRepository/ },
    { label: 'raw SELECT/INSERT SQL', re: /\b(SELECT|INSERT|UPDATE|DELETE)\s+/ },
  ];

  // Strip comments before scanning — the lint is about CODE reading tables, not
  // prose. Doc-comments legitimately mention `cmdb_` / the D16 rule by name.
  const stripComments = (s: string): string =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (keep http:// etc.)

  for (const file of [
    'context-engine.service.ts',
    'context.module.ts',
    'operational-context.types.ts',
    // W6 Phase 2: the graph traversal + cache also reads CMDB only via the
    // provider (it uses Redis, never cmdb_ SQL).
    'cmdb-graph.service.ts',
    'impact-graph.types.ts',
  ]) {
    describe(file, () => {
      const src = stripComments(readFileSync(join(contextDir, file), 'utf8'));
      for (const { label, re } of forbidden) {
        it(`does not contain: ${label}`, () => {
          expect(re.test(src)).toBe(false);
        });
      }
    });
  }
});
