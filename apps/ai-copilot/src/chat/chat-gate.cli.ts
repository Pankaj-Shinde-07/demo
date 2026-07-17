/**
 * W7 gate — a live multi-turn chat session over the orchestrator (the same path
 * the SSE controller streams). Drives all five routes in one session, then reruns
 * two turns in a fresh session for the determinism note.
 *
 *   npm run chat:gate
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import type { ChatResult } from './chat.types';

const TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const log = new Logger('ChatGate');

const TURNS = [
  "What's the EOD-failure restart procedure?",
  'If Sponsor Bank Link A degrades, who is affected?',
  'Explain the current alert storm — what changed before it broke?',
  'What about just branch 23?',
  'Did EOD complete last night?',
];

function summarize(t: string, r: ChatResult) {
  return {
    q: t,
    route: r.route,
    grounded: r.grounded,
    declined: r.declined,
    confidence: r.confidence,
    citations: r.citations.map((c) => `${c.kind}:${c.ref}`),
    answer: r.answer,
  };
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const orch = app.get(ChatOrchestratorService);
  try {
    const session = 'gate-1';
    const transcript: Array<ReturnType<typeof summarize>> = [];
    for (const t of TURNS) {
      const r = await orch.handle({ tenantId: TENANT, sessionId: session, message: t });
      transcript.push(summarize(t, r));
    }

    // Determinism: rerun turns 2 & 3 in a fresh session — route + grounded +
    // citation refs must be stable (prose may vary, the W5 property).
    const a2 = await orch.handle({ tenantId: TENANT, sessionId: 'gate-det', message: TURNS[1] });
    const b2 = await orch.handle({ tenantId: TENANT, sessionId: 'gate-det2', message: TURNS[1] });
    const a3 = await orch.handle({ tenantId: TENANT, sessionId: 'gate-det', message: TURNS[2] });
    const b3 = await orch.handle({ tenantId: TENANT, sessionId: 'gate-det2', message: TURNS[2] });
    const refs = (r: ChatResult) => JSON.stringify(r.citations.map((c) => c.ref).sort());
    const determinism = {
      turn2_sameRoute: a2.route === b2.route,
      turn2_sameRefs: refs(a2) === refs(b2),
      turn2_groundedBoth: a2.grounded && b2.grounded,
      turn3_sameRoute: a3.route === b3.route,
      turn3_sameRefs: refs(a3) === refs(b3),
      turn3_groundedBoth: a3.grounded && b3.grounded,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ proof: 'W7 multi-turn chat gate', transcript, determinism }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
