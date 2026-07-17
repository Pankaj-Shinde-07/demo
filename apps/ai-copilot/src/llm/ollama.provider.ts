import { Injectable } from '@nestjs/common';
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LogicalModel,
} from './llm-provider.interface';

/**
 * On-prem / air-gapped provider seam (D2). Committed empty in W5 — the on-prem
 * story is sold by the seam *existing* and the gateway being able to route to it
 * in hybrid mode, not by a v1 implementation. Wiring a local model (Ollama) is
 * post-v1. It throws rather than returning a fake completion, so a misconfigured
 * route fails loudly instead of silently degrading.
 */
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';

  supports(_model: LogicalModel): boolean {
    return false; // no models served until the on-prem build lands (post-v1)
  }

  async complete(_req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    throw new Error(
      'OllamaProvider is a not-yet-implemented seam (D2). No on-prem model is ' +
        'wired in v1; route reasoning/classification to the Anthropic provider.',
    );
  }
}
