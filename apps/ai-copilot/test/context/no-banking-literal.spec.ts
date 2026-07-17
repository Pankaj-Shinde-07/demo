import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * §6.6 portability-seam lint (W6 Phase 2, CP6.5). The W6 reasoning engine
 * (src/context/**) must carry NO banking/vertical literal — all vertical content
 * lives in `packs/<id>/`. This keeps the engine portable (ADR-003): swapping the
 * active pack to `default` (or a future vertical) must change the framing with no
 * engine edit. Mirrors test/llm/no-direct-sdk-import.spec.ts and
 * test/context/no-direct-table-read.spec.ts.
 *
 * Scope is the portable reasoning core only. Excluded:
 *   - the SynthBank substrate ingestion layer (src/datasource/import/**) — the
 *     vertical-data boundary, like the CMDB workbook itself;
 *   - `*.cli.ts` demo/paste-back harnesses (context-demo, gateway-demo) — these
 *     are developer harnesses pointed at the SynthBank instance and legitimately
 *     name its entities, exactly as the W5 gateway-demo.cli.ts does.
 * The engine services + types that produce the answer are what must stay clean.
 */
describe('§6.6 seam — no banking literal in the context engine', () => {
  const contextDir = join(__dirname, '..', '..', 'src', 'context');
  const files = readdirSync(contextDir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.cli.ts'),
  );

  it('finds the context source files', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('context-engine.service.ts');
  });

  // Banking/vertical literals that must not appear in engine code.
  const forbidden: Array<{ label: string; re: RegExp }> = [
    { label: 'UPI', re: /\bupi\b/i },
    { label: 'IMPS', re: /\bimps\b/i },
    { label: 'NEFT', re: /\bneft\b/i },
    { label: 'RTGS', re: /\brtgs\b/i },
    { label: 'RBI', re: /\brbi\b/i },
    { label: 'CBS (core banking)', re: /\bcbs\b/i },
    { label: 'UCB', re: /\bucb\b/i },
    { label: 'co-operative', re: /co-?operative/i },
    { label: 'CERT-In', re: /cert-in/i },
    { label: 'ATM', re: /\batm\b/i },
    { label: 'NPCI', re: /\bnpci\b/i },
  ];

  // Strip comments before scanning — the lint is about CODE, not prose. Doc
  // comments may legitimately mention a vertical by name.
  const stripComments = (s: string): string =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // W8 reasoning engine (src/incident) + W9 dashboard layer (src/dashboard) are
  // also portable — scan them too (excluding *.cli.ts harnesses).
  const incidentDir = join(__dirname, '..', '..', 'src', 'incident');
  const incidentFiles = readdirSync(incidentDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.cli.ts'));
  const dashboardDir = join(__dirname, '..', '..', 'src', 'dashboard');
  const dashboardFiles = readdirSync(dashboardDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.cli.ts'));

  const scan: Array<{ dir: string; file: string }> = [
    ...files.map((file) => ({ dir: contextDir, file })),
    ...incidentFiles.map((file) => ({ dir: incidentDir, file })),
    ...dashboardFiles.map((file) => ({ dir: dashboardDir, file })),
  ];

  for (const { dir, file } of scan) {
    describe(file, () => {
      const src = stripComments(readFileSync(join(dir, file), 'utf8'));
      for (const { label, re } of forbidden) {
        it(`does not contain the banking literal: ${label}`, () => {
          expect(re.test(src)).toBe(false);
        });
      }
    });
  }
});
