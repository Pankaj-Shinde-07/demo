import { ParsedDocument } from '../parser.types';
import { SectionBuilder } from '../section-builder';

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Markdown parser. Splits on ATX headings (`#`..`######`) to build the section
 * hierarchy; everything else is body text. Heading level = number of `#`.
 * Deliberately dependency-free — full CommonMark parsing is unnecessary for
 * chunk-boundary section paths (W2_BRIEF §5).
 */
export async function parseMarkdown(buffer: Buffer): Promise<ParsedDocument> {
  const raw = buffer.toString('utf-8').replace(/\r\n/g, '\n');
  const builder = new SectionBuilder();
  let sawHeading = false;
  let inFence = false;

  for (const line of raw.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      builder.body(line);
      continue;
    }
    const m = !inFence ? ATX_HEADING.exec(line) : null;
    if (m) {
      sawHeading = true;
      builder.heading(m[1].length, m[2]);
    } else {
      builder.body(line);
    }
  }

  const fullText = raw.trim();
  const sections = sawHeading
    ? builder.build()
    : [{ headingPath: [], text: fullText }];

  return {
    text: fullText,
    sections,
    metadata: { format: 'md' },
  };
}
