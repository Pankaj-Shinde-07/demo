import { ParsedSection } from './parser.types';

/**
 * Builds heading-delimited sections from a stream of heading/body events,
 * tracking a heading stack so each section carries its full heading path.
 *
 * Generic over heading "level" (PDF: dotted-number depth; DOCX/MD: h1..h6).
 * Used by the PDF, DOCX, and Markdown parsers so section_path semantics are
 * identical across prose formats.
 */
export class SectionBuilder {
  private readonly stack: { level: number; text: string }[] = [];
  private readonly sections: ParsedSection[] = [];
  private currentPath: string[] = [];
  private buffer: string[] = [];

  private flush(): void {
    const text = this.buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > 0 || this.currentPath.length > 0) {
      this.sections.push({ headingPath: [...this.currentPath], text });
    }
    this.buffer = [];
  }

  /** Begin a new section at `level` titled `text`. */
  heading(level: number, text: string): void {
    this.flush();
    while (
      this.stack.length > 0 &&
      this.stack[this.stack.length - 1].level >= level
    ) {
      this.stack.pop();
    }
    this.stack.push({ level, text: text.trim() });
    this.currentPath = this.stack.map((s) => s.text);
  }

  /** Append a line of body text to the current section. */
  body(text: string): void {
    this.buffer.push(text);
  }

  /** Finalize and return all sections in document order. */
  build(): ParsedSection[] {
    this.flush();
    return this.sections;
  }
}
