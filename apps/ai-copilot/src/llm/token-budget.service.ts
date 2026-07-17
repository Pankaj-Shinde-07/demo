import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Per-tenant token-budget guard (CP5.5, D10). Reads/writes the W1
// `tenant_token_budget` table. A tenant with no budget row is unbudgeted
// (allowed); a tenant past its hard-stop ceiling is blocked BEFORE the model is
// called — the gateway returns an honest "budget exceeded", never a silent call.

export interface BudgetDecision {
  allowed: boolean;
  configured: boolean;
  softWarn: boolean;
  reason: string | null;
}

@Injectable()
export class TokenBudgetService {
  private readonly logger = new Logger(TokenBudgetService.name);

  constructor(private readonly db: DataSource) {}

  async check(tenantId: string): Promise<BudgetDecision> {
    const [row] = await this.db.query(
      `SELECT monthly_input_tokens_limit AS in_limit,
              monthly_output_tokens_limit AS out_limit,
              current_month_input_tokens AS in_used,
              current_month_output_tokens AS out_used,
              soft_warn_pct, hard_stop_pct
         FROM tenant_token_budget WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!row) return { allowed: true, configured: false, softWarn: false, reason: null };

    const overHard = (used: string | null, limit: string | null, pct: number) =>
      limit != null && Number(used) >= (Number(limit) * pct) / 100;
    const overSoft = (used: string | null, limit: string | null, pct: number) =>
      limit != null && Number(used) >= (Number(limit) * pct) / 100;

    const hardIn = overHard(row.in_used, row.in_limit, Number(row.hard_stop_pct));
    const hardOut = overHard(row.out_used, row.out_limit, Number(row.hard_stop_pct));
    if (hardIn || hardOut) {
      return {
        allowed: false,
        configured: true,
        softWarn: true,
        reason: `tenant token budget hard-stop reached (${hardIn ? 'input' : 'output'} ≥ ${row.hard_stop_pct}% of limit)`,
      };
    }
    const soft =
      overSoft(row.in_used, row.in_limit, Number(row.soft_warn_pct)) ||
      overSoft(row.out_used, row.out_limit, Number(row.soft_warn_pct));
    return { allowed: true, configured: true, softWarn: soft, reason: soft ? 'soft-warn threshold reached' : null };
  }

  /** Increment usage after a successful call (no-op if the tenant has no budget row). */
  async record(tenantId: string, inputTokens: number, outputTokens: number): Promise<void> {
    await this.db.query(
      `UPDATE tenant_token_budget
          SET current_month_input_tokens = current_month_input_tokens + $2,
              current_month_output_tokens = current_month_output_tokens + $3,
              updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, inputTokens, outputTokens],
    );
  }
}
