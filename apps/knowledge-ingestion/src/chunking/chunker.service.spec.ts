import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { encode } from 'gpt-tokenizer';
import { ParserService } from '../parsing/parser.service';
import { ChunkerService } from './chunker.service';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures', 'banking');
const read = (name: string) => fs.readFile(path.join(FIXTURES, name));

describe('ChunkerService (W2 / CP2.2)', () => {
  const parser = new ParserService();
  const chunker = new ChunkerService();

  describe('600/100 sizing (deterministic synthetic input)', () => {
    it('produces 600-token chunks with exactly 100-token overlap', () => {
      // ~1500 distinct tokens, single pathless section.
      const body = Array.from({ length: 1500 }, (_, i) => `tok${i}`).join(' ');
      const parsed = {
        text: body,
        sections: [{ headingPath: [], text: body }],
        metadata: {},
      };
      const chunks = chunker.chunk(parsed, { maxTokens: 600, overlap: 100 });

      expect(chunks.length).toBeGreaterThan(1);
      // every non-final chunk is exactly the window size
      for (const c of chunks.slice(0, -1)) expect(c.tokenCount).toBe(600);
      expect(chunks[chunks.length - 1].tokenCount).toBeLessThanOrEqual(600);

      // overlap proof: sum(tokenCounts) == N + overlap*(numChunks-1)
      const N = encode(`${body}\n\n`).length;
      const sum = chunks.reduce((a, c) => a + c.tokenCount, 0);
      expect(sum).toBe(N + 100 * (chunks.length - 1));
    });

    it('rejects overlap >= maxTokens', () => {
      const parsed = { text: 'x', sections: [{ headingPath: [], text: 'x' }], metadata: {} };
      expect(() => chunker.chunk(parsed, { maxTokens: 100, overlap: 100 })).toThrow();
    });
  });

  describe('row-oriented chunking (cmdb_export)', () => {
    it('emits one chunk per CMDB row carrying columns + row metadata', async () => {
      const parsed = await parser.parse({
        buffer: await read('cmdb-export.xlsx'),
        filename: 'cmdb-export.xlsx',
        documentType: 'cmdb_export',
      });
      const chunks = chunker.chunk(parsed);
      expect(chunks.length).toBe(16);
      expect(chunks[0].metadata.row_oriented).toBe(true);
      expect(chunks[0].chunkText).toContain('ci_id:');
      expect((chunks[0].metadata.cmdb_columns as string[])[0]).toBe('ci_id');
      expect(chunks[0].sectionPath).toEqual([]);
    });
  });

  describe('20-page PDF (the CP2.2 fixture)', () => {
    it('chunks with preserved section_path and 600/100 sizing', async () => {
      const parsed = await parser.parse({
        buffer: await read('rbi-circular-20page.pdf'),
        filename: 'rbi-circular-20page.pdf',
      });
      const chunks = chunker.chunk(parsed);

      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks.slice(0, -1)) expect(c.tokenCount).toBe(600);
      expect(chunks[chunks.length - 1].tokenCount).toBeLessThanOrEqual(600);
      // headings preserved: most chunks carry a non-empty section_path
      const withPath = chunks.filter((c) => c.sectionPath.length > 0).length;
      expect(withPath).toBeGreaterThanOrEqual(chunks.length - 1);

      // ---- CP2.2 paste-back ----
      const first = chunks[0];
      const last = chunks[chunks.length - 1];
      const line = '─'.repeat(72);
      /* eslint-disable no-console */
      console.log(`\n${line}\nCP2.2 PASTE-BACK — 20-page PDF chunking\n${line}`);
      console.log(`page_count: ${parsed.metadata.page_count}`);
      console.log(`chunk_count: ${chunks.length}`);
      console.log(`sizing: maxTokens=600 overlap=100 | non-final tokenCounts all == 600: ${chunks.slice(0, -1).every((c) => c.tokenCount === 600)}`);
      console.log(`chunks with non-empty section_path: ${withPath}/${chunks.length}`);
      console.log(`\n--- FIRST CHUNK (index ${first.chunkIndex}) ---`);
      console.log(`section_path: ${JSON.stringify(first.sectionPath)}`);
      console.log(`token_count: ${first.tokenCount}`);
      console.log(`text:\n${first.chunkText.slice(0, 600)}`);
      console.log(`\n--- A HEADED CHUNK (index 1) section_path: ${JSON.stringify(chunks[1]?.sectionPath)} ---`);
      console.log(`\n--- LAST CHUNK (index ${last.chunkIndex}) ---`);
      console.log(`section_path: ${JSON.stringify(last.sectionPath)}`);
      console.log(`token_count: ${last.tokenCount}`);
      console.log(`text:\n${last.chunkText.slice(0, 600)}`);
      console.log(`${line}\n`);
      /* eslint-enable no-console */
    });
  });
});
