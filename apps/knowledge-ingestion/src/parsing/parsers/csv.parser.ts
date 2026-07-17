import Papa from 'papaparse';
import { ParsedDocument, TableRow } from '../parser.types';
import { buildTableDocument } from './table';

/**
 * CSV parser (table-aware). Parses with a header row and emits structured rows,
 * matching the XLSX parser's shape so `cmdb_export` works from either format.
 */
export async function parseCsv(buffer: Buffer): Promise<ParsedDocument> {
  const text = buffer.toString('utf-8');
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const columns = (result.meta.fields ?? []).map((f) => f.trim());
  const rows: TableRow[] = result.data.map((raw) => {
    const row: TableRow = {};
    for (const col of columns) {
      const v = raw[col];
      row[col] = v === undefined || v === null ? '' : String(v);
    }
    return row;
  });

  return buildTableDocument(columns, rows, {
    format: 'csv',
    parse_errors: result.errors.length,
  });
}
