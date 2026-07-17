import { ParsedDocument, TableRow } from '../parser.types';

/**
 * Shared table → ParsedDocument assembly for the CSV and XLSX parsers.
 *
 * Table-aware parsing preserves column structure (`table_columns`) and emits
 * one structured row object per data row (`table_rows`). The `text` rendering
 * keeps the column headers alongside each row's values so that, even before any
 * row-oriented chunking, the column context survives in plain text.
 */
export function buildTableDocument(
  columns: string[],
  rows: TableRow[],
  extraMetadata: Record<string, unknown> = {},
): ParsedDocument {
  const headerLine = columns.join(' | ');
  const rowLines = rows.map((r) =>
    columns.map((c) => `${c}=${r[c] ?? ''}`).join(' | '),
  );
  const text = [headerLine, ...rowLines].join('\n');

  return {
    text,
    sections: [], // tabular: no prose sections; chunked row-oriented downstream
    metadata: {
      table_columns: columns,
      table_rows: rows,
      row_count: rows.length,
      ...extraMetadata,
    },
  };
}

/** Normalize a raw matrix (array of arrays) into columns + row objects. */
export function matrixToTable(matrix: unknown[][]): {
  columns: string[];
  rows: TableRow[];
} {
  if (matrix.length === 0) return { columns: [], rows: [] };
  const columns = (matrix[0] ?? []).map((c) => String(c ?? '').trim());
  const rows: TableRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    if (raw.every((v) => v === undefined || v === null || String(v).trim() === '')) {
      continue; // skip fully-empty rows
    }
    const row: TableRow = {};
    columns.forEach((col, idx) => {
      row[col] = raw[idx] === undefined || raw[idx] === null ? '' : String(raw[idx]);
    });
    rows.push(row);
  }
  return { columns, rows };
}
