import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

interface SopCategory {
  id: string;
  label?: string;
  match_keywords?: string[];
}

/**
 * SOFT categorization hint (W2_BRIEF §3, §9): reads
 * `${PACKS_ROOT}/{industry}/sop-categories.yaml` and keyword-matches the
 * document title/text to suggest a category. This is a hint on the document
 * record, never a hard classification — every method is failure-tolerant and
 * returns null rather than throwing, so it can NEVER block ingestion.
 */
@Injectable()
export class SopCategoriesService {
  private readonly logger = new Logger(SopCategoriesService.name);
  private readonly packsRoot: string;
  private readonly cache = new Map<string, SopCategory[]>();

  constructor(config: ConfigService) {
    this.packsRoot = config.get<string>('PACKS_ROOT', '/app/packs');
  }

  private async load(industry: string): Promise<SopCategory[]> {
    const cached = this.cache.get(industry);
    if (cached) return cached;
    let categories: SopCategory[] = [];
    try {
      const file = path.join(this.packsRoot, industry, 'sop-categories.yaml');
      const raw = await fs.readFile(file, 'utf-8');
      const doc = yaml.load(raw) as { categories?: SopCategory[] } | null;
      categories = Array.isArray(doc?.categories) ? doc!.categories : [];
    } catch (err) {
      this.logger.warn(
        `No SOP categories for industry "${industry}" (${(err as Error).message}); skipping hint`,
      );
    }
    this.cache.set(industry, categories);
    return categories;
  }

  /**
   * Returns the best-matching category id, or null. `sample` should be the
   * document title plus a slice of its text.
   */
  async hint(industry: string, sample: string): Promise<string | null> {
    try {
      const categories = await this.load(industry);
      if (categories.length === 0) return null;
      const hay = sample.toLowerCase();
      let best: { id: string; score: number } | null = null;
      for (const cat of categories) {
        const score = (cat.match_keywords ?? []).reduce(
          (n, kw) => (kw && hay.includes(kw.toLowerCase()) ? n + 1 : n),
          0,
        );
        if (score > 0 && (!best || score > best.score)) {
          best = { id: cat.id, score };
        }
      }
      return best?.id ?? null;
    } catch (err) {
      this.logger.warn(`SOP hint failed: ${(err as Error).message}`);
      return null;
    }
  }
}
