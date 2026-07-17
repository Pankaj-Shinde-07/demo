import * as Joi from 'joi';

export const aiCopilotEnvValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  AI_COPILOT_PORT: Joi.number().default(3110),

  DATABASE_HOST: Joi.string().default('localhost'),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().default('ems_admin'),
  DATABASE_PASSWORD: Joi.string().required().messages({
    'any.required': 'DATABASE_PASSWORD is required',
  }),
  DATABASE_NAME: Joi.string().default('ems_platform'),

  // W6 Phase 2 (CP6.3): Redis read-through cache for the CMDB graph traversal.
  // The deferred Phase-1 wiring — ems-ai-redis is up but was not yet reachable
  // from this service. Cache is best-effort: a Redis outage degrades to compute,
  // never to a wrong/stale answer (the key is always tenant-scoped).
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  // TTL for a cached traversal. Short by default — the spine is static within a
  // session but a re-import should not serve a long-stale graph.
  CMDB_GRAPH_CACHE_TTL_SECONDS: Joi.number().default(300),
  // Traversal safety bound (cycle-safe regardless; this caps breadth of work).
  CMDB_GRAPH_MAX_DEPTH: Joi.number().default(6),
  // D15 standing demo-discipline disclosure label (e.g. "SynthBank synthetic
  // data"). Empty in a real deployment — the engine carries no instance literal.
  SYNTHETIC_DATA_LABEL: Joi.string().allow('').default(''),

  // W6.5 (T-SECRET): AES-256 key (base64 or 64-hex → 32 bytes) for per-tenant
  // data-source config (e.g. Zabbix API tokens) in tenant_data_sources.
  // config_encrypted. Lives only in the gitignored host .env. When unset,
  // encrypted-config providers degrade to honest empty-state (never plaintext).
  CONFIG_ENCRYPTION_KEY: Joi.string().allow('').default(''),

  // W4: embedding-worker /embed (query-side dense embedding). Service DNS name
  // on ems-network. Timeout covers a single query embed (model already loaded).
  EMBEDDING_WORKER_URL: Joi.string().default('http://embedding-worker:3112'),
  EMBEDDING_TIMEOUT_MS: Joi.number().default(15000),

  // W5 LLM Gateway (D2/D7). The Anthropic key is the ONLY credential the gateway
  // needs; it is read by the @anthropic-ai/sdk client inside AnthropicProvider and
  // never leaves the gateway boundary. Supplied via host .env (gitignored) and the
  // docker-compose `environment:` passthrough — never committed.
  ANTHROPIC_API_KEY: Joi.string().required().messages({
    'any.required':
      'ANTHROPIC_API_KEY is required for the W5 LLM Gateway (set it in the host .env).',
  }),
  // Logical model → provider model-id pins (D2; Sonnet-for-cost per D10).
  LLM_MODEL_SONNET: Joi.string().default('claude-sonnet-4-6'),
  LLM_MODEL_HAIKU: Joi.string().default('claude-haiku-4-5'),
  // Near-zero temperature for factual/grounded answers (determinism, CP5.3).
  LLM_FACTUAL_TEMPERATURE: Joi.number().min(0).max(1).default(0),
});
