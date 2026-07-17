/**
 * Parser layer types (W2 / CP2.1).
 *
 * VERTICAL-AGNOSTIC by contract: nothing in this module (or any parser) may
 * contain an industry-specific literal (`bank`, `UPI`, `RBI`, …). Vertical
 * content lives only in fixtures and packs/{industry}/. See W2_BRIEF §1.
 */

/** A heading-delimited block of prose, carrying its heading hierarchy. */
export interface ParsedSection {
  /**
   * Heading path leading to this block, outermost first.
   * e.g. ['1 Introduction', '1.2 Scope']. Empty for documents with no headings.
   */
  headingPath: string[];
  /** Text under this heading (excludes the heading line itself). */
  text: string;
}

/** One row of a tabular document (e.g. a CMDB export), as column→value. */
export type TableRow = Record<string, string>;

/**
 * Normalized output of every parser. The chunker (CP2.2) consumes `sections`
 * for prose and `metadata` for table/diagram documents.
 */
export interface ParsedDocument {
  /** Full plain-text rendering of the document. */
  text: string;
  /** Heading-delimited sections in document order. Empty for table/diagram docs. */
  sections: ParsedSection[];
  /**
   * Parser-specific structured output. May carry:
   *  - `table_columns: string[]`            (table-aware parsers)
   *  - `table_rows: TableRow[]`             (table-aware parsers)
   *  - `cmdb_columns: string[]`             (cmdb_export — alias of table_columns)
   *  - `needs_review: boolean`              (best-effort parsers, e.g. topology)
   *  - parser/format diagnostics (`page_count`, `sheet_name`, …)
   */
  metadata: Record<string, unknown>;
}

/** Supported parse formats, keyed off file extension. */
export type ParseFormat = 'pdf' | 'docx' | 'txt' | 'md' | 'csv' | 'xlsx';

/** Input to the dispatcher. `documentType` is the upload's declared type. */
export interface ParseRequest {
  buffer: Buffer;
  /** Original filename — used to infer format when needed. */
  filename: string;
  /** Declared document_type (e.g. 'cmdb_export', 'topology_diagram', 'sop'). */
  documentType?: string;
}
