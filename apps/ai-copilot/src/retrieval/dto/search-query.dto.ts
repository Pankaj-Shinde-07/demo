import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsIn,
  IsArray,
  IsISO8601,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const RETRIEVAL_MODES = ['dense', 'sparse', 'hybrid'] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

/**
 * Query params for GET /api/v1/knowledge/search (W4 §1).
 *
 * `tenant_id` is REQUIRED and always enforced in the SQL WHERE clause — there
 * is no unscoped search path. (W5/W6 will move tenant resolution to the JWT;
 * for W4 it is an explicit param so the eval can target the seeded tenant.)
 */
export class SearchQueryDto {
  @ApiProperty({ description: 'Query text. Embedded with the bge query prefix on the dense path.' })
  @IsString()
  @IsNotEmpty()
  q: string;

  @ApiProperty({ description: 'Tenant UUID. Always enforced — no cross-tenant search.' })
  @IsUUID()
  tenant_id: string;

  @ApiPropertyOptional({ description: 'Number of fused results to return (1–100).', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  k: number = 10;

  @ApiPropertyOptional({ description: 'Retrieval mode.', enum: RETRIEVAL_MODES, default: 'hybrid' })
  @IsOptional()
  @IsIn(RETRIEVAL_MODES)
  mode: RetrievalMode = 'hybrid';

  @ApiPropertyOptional({ description: 'Filter by document_type (e.g. cmdb_export, sop, runbook).' })
  @IsOptional()
  @IsString()
  document_type?: string;

  @ApiPropertyOptional({ description: 'Filter by tags (comma-separated). Matches documents overlapping ANY tag.' })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
      : String(value)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
  )
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Only chunks created on/after this ISO-8601 timestamp.' })
  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Only chunks created on/before this ISO-8601 timestamp.' })
  @IsOptional()
  @IsISO8601()
  date_to?: string;
}
