import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/redis.module';
import type { ChatTurn } from './chat.types';

/**
 * W7 (CP7.4) — per-session conversation history in Redis (the already-wired
 * store). Prior turns inform the next; restarting the session clears it (TTL).
 * NO Postgres table — audit lives in ai_audit_log; cross-session persistence is
 * deferred (a W11 additive migration if product wants it). Best-effort: a Redis
 * outage degrades to a stateless single turn, never an error.
 */
const TTL_SECONDS = 3600;
const MAX_TURNS = 20;

@Injectable()
export class ChatSessionStore {
  private readonly logger = new Logger(ChatSessionStore.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(tenantId: string, sessionId: string): string {
    return `chat:session:${tenantId}:${sessionId}`;
  }

  async getHistory(tenantId: string, sessionId: string): Promise<ChatTurn[]> {
    try {
      const raw = await this.redis.get(this.key(tenantId, sessionId));
      return raw ? (JSON.parse(raw) as ChatTurn[]) : [];
    } catch (err) {
      this.logger.warn(`session read failed (stateless turn): ${(err as Error).message}`);
      return [];
    }
  }

  async append(tenantId: string, sessionId: string, ...turns: ChatTurn[]): Promise<void> {
    try {
      const history = await this.getHistory(tenantId, sessionId);
      const next = [...history, ...turns].slice(-MAX_TURNS);
      await this.redis.set(this.key(tenantId, sessionId), JSON.stringify(next), 'EX', TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`session write skipped: ${(err as Error).message}`);
    }
  }

  async clear(tenantId: string, sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.key(tenantId, sessionId));
    } catch {
      /* best-effort */
    }
  }
}
