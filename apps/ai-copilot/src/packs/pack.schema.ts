import { z } from 'zod';

// CP1.4: Zod schemas for the on-disk pack structure.
//
// The four content YAMLs (glossary, severity-rules, cmdb-mappings,
// sop-categories) are validated for *file presence + parseable YAML* only.
// Their inner shapes are z.unknown() until W7+ defines industry-pack content.
// Do not invent richer inner schemas here.

export const PackManifestSchema = z
  .object({
    industry: z
      .string()
      .min(1, 'industry is required')
      .regex(/^[a-z0-9_-]+$/i, 'industry must be a slug (alnum + _ -)'),
    version: z
      .string()
      .min(1, 'version is required')
      .regex(
        /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/,
        'version must be semver (e.g. 1.2.3)',
      ),
    name: z.string().min(1, 'name is required'),
    description: z.string().min(1, 'description is required'),
  })
  .strict();

export type PackManifest = z.infer<typeof PackManifestSchema>;

// Inner content schemas — intentionally z.unknown() at CP1.4. W7+ will
// replace these with concrete shapes once industry-pack content is designed.
export const PackContentSchema = z.unknown();
