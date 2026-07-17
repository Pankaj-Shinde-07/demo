import * as XLSX from 'xlsx';
import { ParsedDocument } from '../parser.types';
import { buildTableDocument, matrixToTable } from './table';

/**
 * XLSX parser (table-aware). Reads the first worksheet, treats row 1 as column
 * headers, and emits structured rows. Used for `cmdb_export` uploads so column
 * structure is preserved for downstream business-impact queries (W2_BRIEF §3).
 */
export async function parseXlsx(buffer: Buffer): Promise<ParsedDocument> {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return buildTableDocument([], [], { format: 'xlsx', sheet_name: null });
  }
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });
  const { columns, rows } = matrixToTable(matrix);
  return buildTableDocument(columns, rows, {
    format: 'xlsx',
    sheet_name: sheetName,
    sheet_count: wb.SheetNames.length,
  });
}
