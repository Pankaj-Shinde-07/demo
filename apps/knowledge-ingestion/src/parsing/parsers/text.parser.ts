import { ParsedDocument } from '../parser.types';

/**
 * Plain-text parser. No heading structure is inferred; the whole document is a
 * single pathless section. The chunker still splits it by the token budget.
 */
export async function parseText(buffer: Buffer): Promise<ParsedDocument> {
  const text = buffer.toString('utf-8').replace(/\r\n/g, '\n').trim();
  return {
    text,
    sections: [{ headingPath: [], text }],
    metadata: { format: 'txt' },
  };
}
