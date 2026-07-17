import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { ZodError } from 'zod';
import { PackManifestSchema } from './pack.schema';
import {
  Pack,
  PackNotFoundError,
  PackSummary,
  PackValidationError,
} from './pack.types';
import {
  ValueModelSchema,
  toValueModel,
  type ValueModel,
} from './value-model.schema';
import { DashboardTemplateSchema, type DashboardTemplate } from '../dashboard/dashboard-schema';

const REQUIRED_CONTENT_FILES = [
  'glossary.yaml',
  'severity-rules.yaml',
  'cmdb-mappings.yaml',
  'sop-categories.yaml',
] as const;

const REQUIRED_SUBDIRS = ['prompt-fragments', 'dashboard-templates'] as const;

@Injectable()
export class PackLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PackLoaderService.name);

  // Discovered, manifest-valid packs keyed by industry slug.
  private readonly summaries = new Map<string, PackSummary>();

  // Pack directories present on disk but with a malformed/missing pack.yaml.
  // Keyed by directory name (used as a fallback industry slug for getPack()).
  private readonly broken = new Map<string, { path: string; issues: unknown[] }>();

  // Fully loaded packs, keyed by `${industry}:${version}`. Populated lazily.
  private readonly cache = new Map<string, Pack>();

  // In-flight load promises for coalescing concurrent getPack() calls.
  private readonly inFlight = new Map<string, Promise<Pack>>();

  async onModuleInit(): Promise<void> {
    const packsRoot = this.resolvePacksRoot();
    if (!(await this.dirExists(packsRoot))) {
      this.logger.warn(
        `Packs root not found at ${packsRoot}; no packs available`,
      );
      return;
    }
    const entries = await fs.readdir(packsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      const packDir = path.join(packsRoot, dirName);
      const manifestPath = path.join(packDir, 'pack.yaml');
      try {
        const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
        const parsed = yaml.load(manifestRaw);
        const manifest = PackManifestSchema.parse(parsed);
        const summary: PackSummary = {
          industry: manifest.industry,
          version: manifest.version,
          name: manifest.name,
          path: packDir,
        };
        this.summaries.set(manifest.industry, summary);
        this.logger.log(
          `Discovered pack ${manifest.industry}@${manifest.version} at ${packDir}`,
        );
      } catch (err) {
        const issues =
          err instanceof ZodError
            ? err.issues
            : [(err as Error).message ?? String(err)];
        this.broken.set(dirName, { path: packDir, issues });
        this.logger.warn(
          `Pack at ${packDir} has an invalid manifest; getPack("${dirName}") will throw PackValidationError`,
        );
      }
    }
    this.logger.log(
      `PackLoaderService discovered ${this.summaries.size} pack(s); ${this.broken.size} broken`,
    );
  }

  async getPack(industry: string, version?: string | null): Promise<Pack> {
    const broken = this.broken.get(industry);
    if (broken) {
      throw new PackValidationError(
        `Pack "${industry}" has an invalid manifest`,
        broken.issues,
      );
    }
    const summary = this.summaries.get(industry);
    if (!summary) {
      throw new PackNotFoundError(industry);
    }
    if (version && version !== summary.version) {
      // Multi-version pack layouts (packs/{industry}/{version}/) are W7+.
      throw new PackNotFoundError(`${industry}@${version}`);
    }
    const resolvedVersion = summary.version;
    const cacheKey = `${industry}:${resolvedVersion}`;

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const inFlight = this.inFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = this.loadPackContents(summary)
      .then((pack) => {
        this.cache.set(cacheKey, pack);
        this.inFlight.delete(cacheKey);
        return pack;
      })
      .catch((err) => {
        this.inFlight.delete(cacheKey);
        throw err;
      });
    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  listAvailablePacks(): PackSummary[] {
    return Array.from(this.summaries.values());
  }

  // Reads pack content files from disk and assembles a Pack. Protected (not
  // private) so test code can jest.spyOn() this method to verify
  // concurrent-load coalescing.
  protected async loadPackContents(summary: PackSummary): Promise<Pack> {
    const issues: string[] = [];
    for (const file of REQUIRED_CONTENT_FILES) {
      if (!(await this.fileExists(path.join(summary.path, file)))) {
        issues.push(`missing required file: ${file}`);
      }
    }
    for (const dir of REQUIRED_SUBDIRS) {
      if (!(await this.dirExists(path.join(summary.path, dir)))) {
        issues.push(`missing required directory: ${dir}/`);
      }
    }
    if (issues.length) {
      throw new PackValidationError(
        `Pack ${summary.industry}@${summary.version} failed structural validation: ${issues.join('; ')}`,
        issues,
      );
    }

    const [glossary, severityRules, cmdbMappings, sopCategories] =
      await Promise.all(
        REQUIRED_CONTENT_FILES.map((file) =>
          this.readYamlFile(path.join(summary.path, file)),
        ),
      );

    const manifestRaw = await fs.readFile(
      path.join(summary.path, 'pack.yaml'),
      'utf-8',
    );
    const manifest = PackManifestSchema.parse(yaml.load(manifestRaw));

    const valueModel = await this.loadValueModel(summary);
    const dashboardTemplates = await this.loadDashboardTemplates(summary);

    return {
      industry: summary.industry,
      version: summary.version,
      name: summary.name,
      path: summary.path,
      description: manifest.description,
      glossary,
      severityRules,
      cmdbMappings,
      sopCategories,
      valueModel,
      dashboardTemplates,
    };
  }

  /**
   * Load + validate dashboard-templates/*.yaml (W9 / CP9.3). Each file must parse
   * as YAML and validate against the Dashboard template schema; an invalid template
   * fails the whole pack loudly (PackValidationError) — a malformed pack file must
   * not ship. Duplicate keys are rejected. An empty directory is fine (returns []).
   */
  private async loadDashboardTemplates(summary: PackSummary): Promise<DashboardTemplate[]> {
    const dir = path.join(summary.path, 'dashboard-templates');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
      .map((e) => e.name)
      .sort();

    const templates: DashboardTemplate[] = [];
    const seenKeys = new Set<string>();
    for (const file of files) {
      const raw = await this.readYamlFile(path.join(dir, file));
      const parsed = DashboardTemplateSchema.safeParse(raw);
      if (!parsed.success) {
        throw new PackValidationError(
          `Pack ${summary.industry}@${summary.version}: dashboard template '${file}' is invalid`,
          parsed.error.issues,
        );
      }
      if (seenKeys.has(parsed.data.key)) {
        throw new PackValidationError(
          `Pack ${summary.industry}@${summary.version}: duplicate dashboard template key '${parsed.data.key}' (${file})`,
          [{ key: parsed.data.key, file }],
        );
      }
      seenKeys.add(parsed.data.key);
      templates.push(parsed.data);
    }
    this.logger.log(
      `Pack ${summary.industry}@${summary.version}: loaded ${templates.length} dashboard template(s)`,
    );
    return templates;
  }

  /**
   * Load value-model.yaml if present (CP6.5). Optional: a pack without one loads
   * with valueModel=null (D15 degrades to a named gap). A malformed value-model
   * IS a hard validation error — a present-but-wrong coefficient must not
   * silently fall through to "no coefficient".
   */
  private async loadValueModel(summary: PackSummary): Promise<ValueModel | null> {
    const filePath = path.join(summary.path, 'value-model.yaml');
    if (!(await this.fileExists(filePath))) return null;
    const raw = await this.readYamlFile(filePath);
    const parsed = ValueModelSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PackValidationError(
        `Pack ${summary.industry}@${summary.version} has an invalid value-model.yaml`,
        parsed.error.issues,
      );
    }
    return toValueModel(parsed.data);
  }

  private async readYamlFile(filePath: string): Promise<unknown> {
    const raw = await fs.readFile(filePath, 'utf-8');
    try {
      return yaml.load(raw);
    } catch (err) {
      throw new PackValidationError(
        `Failed to parse YAML at ${filePath}: ${(err as Error).message}`,
        [(err as Error).message],
      );
    }
  }

  private resolvePacksRoot(): string {
    const fromEnv = process.env.PACKS_ROOT;
    if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
    return path.resolve(process.cwd(), 'packs');
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      const stat = await fs.stat(p);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async dirExists(p: string): Promise<boolean> {
    try {
      const stat = await fs.stat(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
