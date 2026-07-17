import { Injectable } from '@nestjs/common';
import { encode, decode } from 'gpt-tokenizer';
import { ParsedDocument } from '../parsing/parser.types';
import { Chunk, ChunkOptions } from './chunk.types';

const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_OVERLAP = 100;

/**
 * Chunker (W2 / CP2.2).
 *
 * Prose documents: a token-level sliding window (600 tokens, 100 overlap) over
 * the section-tagged token stream. Each chunk's `sectionPath` is the heading
 * path active where the chunk begins, so section headings are preserved per
 * chunk. The leaf heading breadcrumb is prepended to each section's text so the
 * heading is also present in `chunkText` (and therefore in the keyword index).
 *
 * Tabular documents (CMDB exports): row-oriented — one chunk per row, carrying
 * the column headers + row values as structured metadata so retrieval can later
 * answer "which CIs support service X" (W2_BRIEF §3).
 *
 * Tokenizer note (W2_BRIEF §5): cl100k_base is a deterministic approximation;
 * the embedding model (bge-large, W3) has its own tokenizer. Exact alignment is
 * not required for chunk boundaries in v1.
 */
@Injectable()
export class ChunkerService {
  chunk(parsed: ParsedDocument, options: ChunkOptions = {}): Chunk[] {
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const overlap = options.overlap ?? DEFAULT_OVERLAP;
    if (overlap >= maxTokens) {
      throw new Error('overlap must be smaller than maxTokens');
    }

    // Tabular → row-oriented chunks.
    const rows = parsed.metadata?.table_rows as
      | Record<string, string>[]
      | undefined;
    if (Array.isArray(rows) && rows.length > 0) {
      return this.chunkRows(parsed, rows);
    }

    return this.chunkProse(parsed, maxTokens, overlap);
  }

  private chunkProse(
    parsed: ParsedDocument,
    maxTokens: number,
    overlap: number,
  ): Chunk[] {
    // Build a single token stream, recording the section path of every token.
    const tokens: number[] = [];
    const tokenPath: string[][] = [];

    const sections =
      parsed.sections.length > 0
        ? parsed.sections
        : [{ headingPath: [], text: parsed.text }];

    for (const section of sections) {
      const breadcrumb =
        section.headingPath.length > 0
          ? `${section.headingPath.join(' > ')}\n`
          : '';
      const sectionText = `${breadcrumb}${section.text}`.trim();
      if (sectionText.length === 0) continue;
      const sectionTokens = encode(`${sectionText}\n\n`);
      for (const t of sectionTokens) {
        tokens.push(t);
        tokenPath.push(section.headingPath);
      }
    }

    if (tokens.length === 0) return [];

    const step = maxTokens - overlap;
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (let start = 0; start < tokens.length; start += step) {
      const end = Math.min(start + maxTokens, tokens.length);
      const slice = tokens.slice(start, end);
      const text = decode(slice).trim();
      if (text.length > 0) {
        chunks.push({
          chunkIndex: chunkIndex++,
          chunkText: text,
          tokenCount: slice.length,
          sectionPath: tokenPath[start] ?? [],
          metadata: {},
        });
      }
      if (end === tokens.length) break;
    }

    return chunks;
  }

  private chunkRows(
    parsed: ParsedDocument,
    rows: Record<string, string>[],
  ): Chunk[] {
    const columns = (parsed.metadata.table_columns as string[]) ?? [];
    return rows.map((row, i) => {
      const text = columns.map((c) => `${c}: ${row[c] ?? ''}`).join('\n');
      return {
        chunkIndex: i,
        chunkText: text,
        tokenCount: encode(text).length,
        sectionPath: [],
        metadata: {
          cmdb_columns: columns,
          row,
          row_oriented: true,
        },
      };
    });
  }
}
