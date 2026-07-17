import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin client for the embedding-worker's synchronous /embed endpoint
 * (W4 Amendment B). One model, one owner: the query is embedded by the same
 * bge-large instance that embedded the passages, and the bge query prefix is
 * applied worker-side — this service never re-implements the prefix or loads a
 * model. We only consume the unit-normalized 1024-vector it returns.
 */
@Injectable()
export class EmbeddingClient {
  private readonly logger = new Logger(EmbeddingClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  static readonly EXPECTED_DIM = 1024;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .get<string>('EMBEDDING_WORKER_URL', 'http://embedding-worker:3112')
      .replace(/\/+$/, '');
    this.timeoutMs = config.get<number>('EMBEDDING_TIMEOUT_MS', 15000);
  }

  /** Embed a single query string. Returns a unit-normalized 1024-vector. */
  async embedQuery(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.error(`embedding-worker unreachable at ${this.baseUrl}/embed: ${err}`);
      throw new ServiceUnavailableException('embedding service unavailable');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // 503 during cold start (model still loading) bubbles up as 503 to the caller.
      this.logger.warn(`/embed returned ${res.status}`);
      throw new ServiceUnavailableException(`embedding service returned ${res.status}`);
    }

    const body = (await res.json()) as { embedding?: unknown; dim?: number };
    const embedding = body.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length !== EmbeddingClient.EXPECTED_DIM ||
      !embedding.every((v) => typeof v === 'number')
    ) {
      throw new ServiceUnavailableException(
        `embedding service returned malformed vector (dim=${
          Array.isArray(embedding) ? embedding.length : 'n/a'
        }, expected ${EmbeddingClient.EXPECTED_DIM})`,
      );
    }
    return embedding as number[];
  }
}
