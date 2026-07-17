import { lastValueFrom, toArray, type Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import { ChatController } from '../../src/chat/chat.controller';
import type { ChatResult, ChatStreamEvent } from '../../src/chat/chat.types';

/**
 * T-STREAM-FABRICATION (the survival-critical invariant at the user surface):
 * the grounding / hard-reject decision resolves BEFORE the stream starts — an
 * ungrounded/declined answer NEVER begins streaming tokens. These tests drive the
 * controller's SSE generator with a stub orchestrator (no DB/LLM).
 */

function controllerWith(result: ChatResult): ChatController {
  const orchestrator = { handle: jest.fn(async () => result) } as any;
  return new ChatController(orchestrator);
}

async function collect(obs: Observable<MessageEvent>): Promise<ChatStreamEvent[]> {
  const events = await lastValueFrom(obs.pipe(toArray()));
  return events.map((e) => e.data as ChatStreamEvent);
}

const declined: ChatResult = {
  route: 'out_of_scope',
  answer: 'I cannot see that live state and will not guess.',
  grounded: false,
  declined: true,
  citations: [],
  confidence: { level: 'high', reasons: ['boundary stated'] },
  evidenceCount: 0,
  model: null,
  redirect: 'here is the runbook',
};

const grounded: ChatResult = {
  route: 'grounded_context',
  answer: 'Sponsor Bank Link A affects 450000 customers across 50 branches.',
  grounded: true,
  declined: false,
  citations: [{ ref: 'impact:customers_affected', label: 'customers', kind: 'impact' }],
  confidence: { level: 'high', reasons: ['traversal-derived'] },
  evidenceCount: 7,
  model: 'claude-sonnet-4-6',
};

describe('W7 SSE streaming invariant', () => {
  it('a DECLINED answer never streams a token (hard-reject before stream)', async () => {
    const events = await collect(controllerWith(declined).stream('did EOD complete?', 's', 't'));
    expect(events.some((e) => e.type === 'token')).toBe(false); // no fabrication tokens
    expect(events.some((e) => e.type === 'decline')).toBe(true);
    expect(events[0].type).toBe('route'); // route first, then the honest decline
    expect(events[events.length - 1]).toMatchObject({ type: 'done', grounded: false, declined: true });
  });

  it('a GROUNDED answer streams tokens then citations + confidence + done', async () => {
    const events = await collect(controllerWith(grounded).stream('who is affected?', 's', 't'));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('route');
    expect(events.some((e) => e.type === 'token')).toBe(true);
    expect(events.some((e) => e.type === 'citations')).toBe(true);
    expect(events.some((e) => e.type === 'confidence')).toBe(true);
    // citations + confidence + done come AFTER the last token (resolved → streamed)
    const lastToken = types.lastIndexOf('token');
    expect(types.indexOf('citations')).toBeGreaterThan(lastToken);
    // reassembled tokens equal the resolved answer (nothing invented mid-stream)
    const text = events.filter((e): e is Extract<ChatStreamEvent, { type: 'token' }> => e.type === 'token').map((e) => e.text).join('');
    expect(text).toBe(grounded.answer);
  });
});
