import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import type { DocumentType } from '../../entities/knowledge-document.entity';

const DOCUMENT_TYPES: DocumentType[] = [
  'manual', 'sop', 'rca', 'runbook', 'datasheet',
  'cmdb_export', 'topology_diagram', 'other',
];

/** Multipart fields accompanying the uploaded `file`. */
export class UploadDocumentDto {
  @IsUUID()
  tenant_id: string;

  @IsIn(DOCUMENT_TYPES)
  document_type: DocumentType;

  /** Optional title override; defaults to the filename if omitted. */
  @IsOptional()
  @IsString()
  title?: string;

  /**
   * Tags as a comma-separated string (multipart fields are strings) or a JSON
   * array string. Normalized to string[].
   */
  @IsOptional()
  @Transform(({ value }) => normalizeTags(value))
  @IsString({ each: true })
  tags?: string[];
}

function normalizeTags(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map(String);
  const s = String(value).trim();
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through to CSV parsing */
    }
  }
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}
