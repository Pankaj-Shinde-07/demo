import * as mammoth from 'mammoth';
import { ParsedDocument } from '../parser.types';
import { SectionBuilder } from '../section-builder';

const TAG = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * DOCX parser. Converts to HTML via mammoth (which maps Word "Heading N" styles
 * to <h1>..<h6>), then walks the heading/paragraph stream to rebuild a section
 * hierarchy with full heading paths.
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const builder = new SectionBuilder();
  const textParts: string[] = [];
  let sawHeading = false;

  let match: RegExpExecArray | null;
  while ((match = TAG.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const content = stripTags(match[2]);
    if (content.length === 0) continue;
    if (tag.startsWith('h')) {
      sawHeading = true;
      const level = Number(tag[1]);
      builder.heading(level, content);
      textParts.push(content);
    } else {
      builder.body(content);
      textParts.push(content);
    }
  }

  const fullText = textParts.join('\n').trim();
  const sections = sawHeading
    ? builder.build()
    : [{ headingPath: [], text: fullText }];

  return {
    text: fullText,
    sections,
    metadata: { format: 'docx' },
  };
}
