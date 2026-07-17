import { ParsedDocument } from '../parser.types';
import { SectionBuilder } from '../section-builder';
import { extractPdfText } from './pdf-extract';

// Numbered heading like "1 Introduction" or "3.2 Reporting Timeline".
// Level = number of dotted components. Vertical-agnostic structural heuristic.
const NUMBERED_HEADING = /^(\d+(?:\.\d+){0,5})\s+(\S.*)$/;

/**
 * PDF parser. Extracts the text layer via pdf-parse and reconstructs a section
 * hierarchy from numbered-heading lines (best-effort — PDFs carry no semantic
 * heading metadata). Documents without numbered headings yield a single
 * pathless section holding the full text.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const { text, pageCount } = await extractPdfText(buffer);
  const fullText = text;
  const builder = new SectionBuilder();
  let sawHeading = false;

  for (const rawLine of fullText.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const m = NUMBERED_HEADING.exec(line);
    // Treat as a heading only if the title part is reasonably short (avoids
    // catching numbered list items / sentences that begin with a figure).
    if (m && m[2].length <= 80) {
      sawHeading = true;
      builder.heading(m[1].split('.').length, line);
    } else {
      builder.body(line);
    }
  }

  const sections = sawHeading
    ? builder.build()
    : [{ headingPath: [], text: fullText.trim() }];

  return {
    text: fullText.trim(),
    sections,
    metadata: {
      page_count: pageCount,
      format: 'pdf',
    },
  };
}
