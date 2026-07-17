import * as Joi from 'joi';

// W2/CP2.3 adds Postgres (TypeORM), Redis (BullMQ), the packs root (soft
// categorization hint) and the upload staging dir to the validated env.
export const knowledgeIngestionEnvValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  KNOWLEDGE_INGESTION_PORT: Joi.number().default(3111),

  // Postgres (W1-owned AI schema)
  DATABASE_HOST: Joi.string().default('postgres'),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_NAME: Joi.string().default('ems_platform'),
  DATABASE_USER: Joi.string().default('ems_admin'),
  DATABASE_PASSWORD: Joi.string().required(),

  // Redis (BullMQ)
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().default(6379),

  // Packs root for the SOP categorization hint (soft feature)
  PACKS_ROOT: Joi.string().default('/app/packs'),

  // Where uploaded files are staged for async processing
  UPLOAD_DIR: Joi.string().default('/tmp/ki-uploads'),

  // Upload cap (bytes) — 50MB per W2_BRIEF §3
  MAX_UPLOAD_BYTES: Joi.number().default(52428800),
});
