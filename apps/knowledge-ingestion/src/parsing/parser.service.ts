import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as path from 'node:path';
import { ParsedDocument, ParseFormat, ParseRequest } from './parser.types';
import { parsePdf } from './parsers/pdf.parser';
import { parseDocx } from './parsers/docx.parser';
import { parseText } from './parsers/text.parser';
import { parseMarkdown } from './parsers/markdown.parser';
import { parseCsv } from './parsers/csv.parser';
import { parseXlsx } from './parsers/xlsx.parser';
import { parseTopology } from './parsers/topology.parser';

const EXT_FORMAT: Record<string, ParseFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
  '.csv': 'csv',
  '.xlsx': 'xlsx',
};

/**
 * Parser dispatcher (W2 / CP2.1). Routes an upload to the right parser by
 * declared `documentType` first (so `cmdb_export` and `topology_diagram` get
 * their special handling regardless of extension) then by file format.
 *
 * VERTICAL-AGNOSTIC: contains no industry literal. `cmdb` / `topology` are
 * generic IT concepts, declared in the W1 schema, not vertical content.
 */
@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  detectFormat(filename: string): ParseFormat | null {
    return EXT_FORMAT[path.extname(filename).toLowerCase()] ?? null;
  }

  async parse(req: ParseRequest): Promise<ParsedDocument> {
    const format = this.detectFormat(req.filename);

    // 1. document_type-driven special parsers.
    if (req.documentType === 'topology_diagram') {
      const parsed = await parseTopology(req.buffer);
      this.logger.warn(
        `topology_diagram "${req.filename}" parsed best-effort; flagged needs_review`,
      );
      return parsed;
    }

    if (req.documentType === 'cmdb_export') {
      const parsed =
        format === 'csv'
          ? await parseCsv(req.buffer)
          : await parseXlsx(req.buffer); // default cmdb_export to spreadsheet
      // Expose the table columns under the schema's cmdb_columns key (W1).
      parsed.metadata.cmdb_columns = parsed.metadata.table_columns ?? [];
      return parsed;
    }

    // 2. format-driven parsers.
    switch (format) {
      case 'pdf':
        return parsePdf(req.buffer);
      case 'docx':
        return parseDocx(req.buffer);
      case 'txt':
        return parseText(req.buffer);
      case 'md':
        return parseMarkdown(req.buffer);
      case 'csv':
        return parseCsv(req.buffer);
      case 'xlsx':
        return parseXlsx(req.buffer);
      default:
        throw new BadRequestException(
          `Unsupported file type for "${req.filename}". Supported: PDF, DOCX, TXT, MD, CSV, XLSX.`,
        );
    }
  }
}
