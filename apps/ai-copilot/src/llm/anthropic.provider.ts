import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LogicalModel,
} from './llm-provider.interface';

/**
 * The live Anthropic provider (D2). **This is the ONLY module in the codebase
 * permitted to import @anthropic-ai/sdk** (D7 chokepoint — lint-enforced by
 * test/llm/no-direct-sdk-import.spec.ts). It resolves logical model names to the
 * pinned provider ids and translates the neutral LlmCompletionRequest to the
 * Messages API. No grounding/masking/audit logic lives here — that's the
 * gateway's job; the provider only speaks to the model.
 */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;
  private readonly modelIds: Record<LogicalModel, string>;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
    this.modelIds = {
      sonnet: this.config.get<string>('LLM_MODEL_SONNET', 'claude-sonnet-4-6'),
      haiku: this.config.get<string>('LLM_MODEL_HAIKU', 'claude-haiku-4-5'),
    };
  }

  supports(model: LogicalModel): boolean {
    return model === 'sonnet' || model === 'haiku';
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const modelId = this.modelIds[req.model];
    const started = Date.now();

    const system = req.system.map((b) => ({
      type: 'text' as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));

    const resp = await this.client.messages.create({
      model: modelId,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0,
      system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      // Structured outputs (CP5.3): constrain the response to the gateway's
      // grounding schema so evidence_refs is always a reliable array, not a
      // free-text line the model can drop. Supported on Sonnet 4.6 / Haiku 4.5.
      ...(req.jsonSchema
        ? { output_config: { format: { type: 'json_schema' as const, schema: req.jsonSchema } } }
        : {}),
    } as Anthropic.MessageCreateParamsNonStreaming);

    const content = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      content,
      usage: {
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: resp.usage.cache_creation_input_tokens ?? 0,
      },
      modelId,
      stopReason: resp.stop_reason ?? null,
      latencyMs: Date.now() - started,
    };
  }
}
