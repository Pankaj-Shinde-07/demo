import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D7 boundary lint: NO module outside the gateway's provider layer may import the
 * Anthropic SDK directly. Every model call goes through LlmGateway → provider.
 * This mirrors the W6 ContextEngine no-direct-table-read lint. The single
 * permitted importer is `src/llm/anthropic.provider.ts`.
 */
describe('D7 boundary — only the Anthropic provider imports @anthropic-ai/sdk', () => {
  const srcRoot = join(__dirname, '..', '..', 'src');
  const ALLOWED = ['llm/anthropic.provider.ts'];
  // Match an actual import/require of the SDK — not a prose mention in a comment.
  const SDK_IMPORT = /(?:import[^;\n]*from|require\(|import\()\s*['"]@anthropic-ai\/sdk['"]/;

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  const offenders = walk(srcRoot).filter((file) => {
    const rel = file.slice(srcRoot.length + 1).replace(/\\/g, '/');
    if (ALLOWED.includes(rel)) return false;
    return SDK_IMPORT.test(readFileSync(file, 'utf8'));
  });

  it('the allowed importer exists', () => {
    expect(SDK_IMPORT.test(readFileSync(join(srcRoot, 'llm/anthropic.provider.ts'), 'utf8'))).toBe(true);
  });

  it('no other source file imports the Anthropic SDK', () => {
    expect(offenders.map((f) => f.slice(srcRoot.length + 1))).toEqual([]);
  });
});
