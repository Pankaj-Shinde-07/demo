// W5 LLM provider contract (D2). Fleshed out from the W1 compile-only stub.
// AnthropicProvider implements this live; OllamaProvider is an empty seam.
//
// D7 boundary: ONLY a provider implementation may import a vendor SDK
// (@anthropic-ai/sdk). No other module calls a model directly — everything goes
// through LlmGateway → provider. Enforced by test/llm/no-direct-sdk-import.spec.ts.

/** Logical model names; the provider resolves these to pinned provider ids. */
export type LogicalModel = 'sonnet' | 'haiku';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * An ordered system-prompt block. `cache: true` marks a prompt-caching breakpoint
 * (stable prefix — system + pack fragments). Volatile content (the per-request
 * question/evidence) goes in `messages`, after the cached prefix. (CP5.5)
 */
export interface LlmSystemBlock {
  text: string;
  cache?: boolean;
}

export interface LlmCompletionRequest {
  feature: string; // 'chat' | 'alert_explain' | 'rca_draft' | 'classify_intent' | ...
  model: LogicalModel;
  system: LlmSystemBlock[];
  messages: LlmMessage[];
  maxTokens: number;
  temperature?: number; // near-zero for factual/grounded answers (CP5.3)
  stream?: boolean; // thin seam; W7 owns the SSE surface
  /**
   * When set, the provider constrains the response to this JSON schema
   * (structured outputs). Used by the gateway to FORCE a reliable evidence_refs
   * list instead of parsing a free-text citation line (CP5.3 robustness).
   */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmCompletionResponse {
  content: string;
  usage: LlmUsage;
  modelId: string; // resolved provider id, e.g. 'claude-sonnet-4-6'
  stopReason: string | null;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string; // 'anthropic' | 'ollama' | ...
  /** Resolve `req.model` to a provider id and complete. */
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse>;
  /** Which logical models this provider can serve (capability seam for hybrid). */
  supports(model: LogicalModel): boolean;
}
