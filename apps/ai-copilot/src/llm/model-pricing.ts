import type { LlmUsage } from './llm-provider.interface';

// Per-model pricing in USD per 1M tokens (cached 2026; D10 cost tracking).
// Cache reads ≈ 0.1× input; cache writes (5-min TTL) ≈ 1.25× input.
interface Rate {
  inputPerM: number;
  outputPerM: number;
}

const RATES: Record<string, Rate> = {
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 },
};

const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

/** Estimated USD cost for one call. Returns null for an unknown model id. */
export function estimateCostUsd(modelId: string, usage: LlmUsage): number | null {
  const rate = RATES[modelId];
  if (!rate) return null;
  const inM = rate.inputPerM / 1_000_000;
  const outM = rate.outputPerM / 1_000_000;
  const cost =
    usage.inputTokens * inM +
    usage.outputTokens * outM +
    usage.cacheReadTokens * inM * CACHE_READ_FACTOR +
    usage.cacheWriteTokens * inM * CACHE_WRITE_FACTOR;
  return Number(cost.toFixed(6));
}
