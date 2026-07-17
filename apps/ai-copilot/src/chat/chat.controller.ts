import { Body, Controller, Get, Post, Query, Sse, type MessageEvent } from '@nestjs/common';
import { from, type Observable } from 'rxjs';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import type { ChatRequest, ChatResult, ChatStreamEvent } from './chat.types';

const DEFAULT_TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';

/**
 * W7 — Copilot Chat SSE surface (the thin delivery layer; production React is
 * W11). GET /api/v1/ai/chat/stream streams the answer over SSE; the streaming
 * INVARIANT (T-STREAM-FABRICATION) is structural: handle() fully RESOLVES the
 * grounding / hard-reject decision before the async generator yields its first
 * token — an ungrounded answer never begins streaming. POST /api/v1/ai/chat is
 * the non-streaming variant (curl/CLI/tests).
 */
@Controller('api/v1/ai/chat')
export class ChatController {
  constructor(private readonly orchestrator: ChatOrchestratorService) {}

  @Sse('stream')
  stream(
    @Query('q') q: string,
    @Query('session') session = 'default',
    @Query('tenant') tenant = DEFAULT_TENANT,
    @Query('pack') pack = 'banking',
  ): Observable<MessageEvent> {
    const req: ChatRequest = { tenantId: tenant, sessionId: session, message: q ?? '', packId: pack };
    return from(this.toEvents(req));
  }

  @Post()
  async chat(@Body() body: Partial<ChatRequest>): Promise<ChatResult> {
    const req: ChatRequest = {
      tenantId: body.tenantId ?? DEFAULT_TENANT,
      sessionId: body.sessionId ?? 'default',
      message: body.message ?? '',
      packId: body.packId ?? 'banking',
    };
    return this.orchestrator.handle(req);
  }

  /**
   * The stream generator. The FIRST line awaits the fully-resolved ChatResult —
   * nothing is yielded to the client until grounding is decided. Then: route →
   * (tokens | decline) → citations → confidence → done.
   */
  private async *toEvents(req: ChatRequest): AsyncGenerator<MessageEvent> {
    const result = await this.orchestrator.handle(req); // grounding RESOLVED here
    const emit = (e: ChatStreamEvent): MessageEvent => ({ data: e });

    yield emit({ type: 'route', route: result.route });

    if (result.declined) {
      yield emit({ type: 'decline', text: result.answer, redirect: result.redirect ?? null });
    } else {
      for (const chunk of this.chunk(result.answer)) yield emit({ type: 'token', text: chunk });
    }
    if (result.citations.length) yield emit({ type: 'citations', citations: result.citations });
    yield emit({ type: 'confidence', confidence: result.confidence });
    yield emit({ type: 'done', grounded: result.grounded, declined: result.declined, model: result.model });
  }

  /** Chunk the resolved answer for a streaming feel (deterministic, ~6 words). */
  private chunk(text: string): string[] {
    const words = text.split(/(\s+)/);
    const out: string[] = [];
    let buf = '';
    let count = 0;
    for (const w of words) {
      buf += w;
      if (/\S/.test(w)) count++;
      if (count >= 6) {
        out.push(buf);
        buf = '';
        count = 0;
      }
    }
    if (buf) out.push(buf);
    return out;
  }
}
