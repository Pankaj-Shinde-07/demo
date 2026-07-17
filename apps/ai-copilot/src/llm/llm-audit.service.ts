import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';

// Audit logging (CP5.5, D7). Every model call — grounded answer, honest decline,
// budget-block, or error — lands one row in the W1 `ai_audit_log` table. Excerpts
// are stored already-masked (the gateway masks before audit), and only a hash of
// the full prompt is kept, never the full prompt text.

export interface AuditEntry {
  tenantId: string;
  feature: string;
  model: string; // resolved provider id, or 'n/a' for pre-call blocks
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  promptForHash: string; // full assembled (masked) prompt — hashed, not stored
  promptExcerpt: string | null; // masked
  responseExcerpt: string | null;
  evidenceRefCount: number;
  errorCode: string | null;
}

@Injectable()
export class LlmAuditService {
  private readonly logger = new Logger(LlmAuditService.name);

  constructor(private readonly db: DataSource) {}

  async log(entry: AuditEntry): Promise<string> {
    const promptHash = createHash('sha256').update(entry.promptForHash).digest('hex');
    const [row] = await this.db.query(
      `INSERT INTO ai_audit_log
         (tenant_id, feature, model, provider, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, latency_ms, prompt_hash,
          prompt_excerpt, response_excerpt, evidence_ref_count, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        entry.tenantId,
        entry.feature,
        entry.model,
        entry.provider,
        entry.inputTokens,
        entry.outputTokens,
        entry.cacheReadTokens,
        entry.cacheWriteTokens,
        entry.latencyMs,
        promptHash,
        entry.promptExcerpt?.slice(0, 500) ?? null,
        entry.responseExcerpt?.slice(0, 500) ?? null,
        entry.evidenceRefCount,
        entry.errorCode,
      ],
    );
    return row.id as string;
  }
}
