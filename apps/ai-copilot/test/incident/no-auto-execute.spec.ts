import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-AUTO-EXECUTE: zero auto-execute is locked. Every W8 output is a proposal/draft
 * a human attests/executes. This lint fails if any W8 source enables auto-execute
 * or reaches for an action-executing primitive.
 */
describe('T-AUTO-EXECUTE — W8 proposes, never executes', () => {
  const incidentDir = join(__dirname, '..', '..', 'src', 'incident');
  const sources = readdirSync(incidentDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ f, src: readFileSync(join(incidentDir, f), 'utf8') }));

  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('no source enables auto-execute', () => {
    for (const { f, src } of sources) {
      const code = stripComments(src);
      expect({ f, hit: /autoExecute\s*:\s*true/.test(code) }).toEqual({ f, hit: false });
    }
  });

  it('no source reaches for an action-executing primitive', () => {
    const forbidden = [/child_process/, /\.exec\(/, /execSync/, /\bspawn\(/, /autoSubmit/, /auto_remediat/i];
    for (const { f, src } of sources) {
      const code = stripComments(src);
      for (const re of forbidden) {
        expect({ f, re: re.source, hit: re.test(code) }).toEqual({ f, re: re.source, hit: false });
      }
    }
  });
});
