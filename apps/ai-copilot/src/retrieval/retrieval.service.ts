import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingClient } from './embedding.client';
import { reciprocalRankFusion, RankedHit, RRF_K, RRF_WEIGHTS } from './rrf';
import { SearchQueryDto } from './dto/search-query.dto';

/**
 * Number of candidates each path (dense, sparse) pulls before fusion (W4 §4).
 * The fused list is sliced to the caller's `k`. Keeping a 50-deep candidate
 * pool means a future bge-reranker (deferred in W4) can re-score top-50 → top-10
 * without changing retrieval — the candidates already flow through.
 */
export const CANDIDATE_POOL = 50;

export interface SearchHit {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  documentTitle: string;
  documentType: string;
  sectionPath: string[];
  snippet: string;
  /** Full chunk text — grounding content for W7 chat (snippet is the UI preview). */
  text: string;
  /** RRF score (hybrid) or the single-mode raw score. */
  score: number;
  denseRank: number | null;
  sparseRank: number | null;
}

export interface SearchResult {
  query: string;
  mode: string;
  k: number;
  candidatePool: number;
  rrfK: number;
  count: number;
  results: SearchHit[];
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingClient: EmbeddingClient,
  ) {}

  async search(dto: SearchQueryDto): Promise<SearchResult> {
    const k = dto.k ?? 10;
    const mode = dto.mode ?? 'hybrid';

    let dense: RankedHit[] = [];
    let sparse: RankedHit[] = [];

    if (mode === 'dense' || mode === 'hybrid') {
      dense = await this.denseSearch(dto);
    }
    if (mode === 'sparse' || mode === 'hybrid') {
      sparse = await this.sparseSearch(dto);
    }

    let orderedIds: string[];
    const denseRank = new Map(dense.map((h) => [h.chunkId, h.rank]));
    const sparseRank = new Map(sparse.map((h) => [h.chunkId, h.rank]));
    const scoreById = new Map<string, number>();

    if (mode === 'dense') {
      orderedIds = dense.slice(0, k).map((h) => h.chunkId);
      dense.forEach((h) => scoreById.set(h.chunkId, h.score));
    } else if (mode === 'sparse') {
      orderedIds = sparse.slice(0, k).map((h) => h.chunkId);
      sparse.forEach((h) => scoreById.set(h.chunkId, h.score));
    } else {
      // hybrid: RRF over [dense, sparse], dense-biased 4:1 (RRF_WEIGHTS) per the
      // W4 RRF tuning pass — stops the weak sparse path diluting dense while keeping
      // sparse's exact-token wins. See rrf.ts / RETRIEVAL_BASELINE.md.
      const fused = reciprocalRankFusion([dense, sparse], RRF_K, RRF_WEIGHTS);
      fused.forEach((f) => scoreById.set(f.chunkId, f.rrfScore));
      orderedIds = fused.slice(0, k).map((f) => f.chunkId);
    }

    const hydrated = await this.hydrate(orderedIds, dto.tenant_id);
    const results: SearchHit[] = orderedIds
      .map((id) => {
        const row = hydrated.get(id);
        if (!row) return null;
        return {
          chunkId: id,
          documentId: row.document_id,
          chunkIndex: row.chunk_index,
          documentTitle: row.document_title,
          documentType: row.document_type,
          sectionPath: row.section_path ?? [],
          snippet: this.snippet(row.chunk_text),
          text: row.chunk_text,
          score: scoreById.get(id) ?? 0,
          denseRank: denseRank.get(id) ?? null,
          sparseRank: sparseRank.get(id) ?? null,
        } as SearchHit;
      })
      .filter((r): r is SearchHit => r !== null);

    return {
      query: dto.q,
      mode,
      k,
      candidatePool: CANDIDATE_POOL,
      rrfK: RRF_K,
      count: results.length,
      results,
    };
  }

  /** Dense path: bge query embedding → cosine distance over the HNSW index. */
  private async denseSearch(dto: SearchQueryDto): Promise<RankedHit[]> {
    const vector = await this.embeddingClient.embedQuery(dto.q);
    const vectorLiteral = `[${vector.join(',')}]`;

    // params: $1 vector, $2 tenant, $3 limit, $4+ filters
    const filters = this.buildFilters(dto, 4);
    const params = [vectorLiteral, dto.tenant_id, CANDIDATE_POOL, ...filters.params];

    const rows: Array<{ id: string; distance: number }> = await this.dataSource.query(
      `
      SELECT c.id, (c.embedding <=> $1::vector) AS distance
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.tenant_id = $2::uuid
        AND c.embedding IS NOT NULL
        AND d.deleted_at IS NULL${filters.clause}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $3
      `,
      params,
    );

    // cosine distance ∈ [0,2]; similarity = 1 - distance (both vectors unit-norm)
    return rows.map((r, i) => ({
      chunkId: r.id,
      rank: i + 1,
      score: 1 - Number(r.distance),
    }));
  }

  /** Sparse path: websearch_to_tsquery + ts_rank_cd over the GIN ts_vector. */
  private async sparseSearch(dto: SearchQueryDto): Promise<RankedHit[]> {
    // params: $1 query text, $2 tenant, $3 limit, $4+ filters
    const filters = this.buildFilters(dto, 4);
    const params = [dto.q, dto.tenant_id, CANDIDATE_POOL, ...filters.params];

    const rows: Array<{ id: string; rank_score: number }> = await this.dataSource.query(
      `
      SELECT c.id, ts_rank_cd(c.ts_vector, websearch_to_tsquery('english', $1)) AS rank_score
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.tenant_id = $2::uuid
        AND d.deleted_at IS NULL
        AND c.ts_vector @@ websearch_to_tsquery('english', $1)${filters.clause}
      ORDER BY rank_score DESC, c.id
      LIMIT $3
      `,
      params,
    );

    return rows.map((r, i) => ({
      chunkId: r.id,
      rank: i + 1,
      score: Number(r.rank_score),
    }));
  }

  /** Fetch display fields for the final top-k, tenant-scoped. */
  private async hydrate(
    chunkIds: string[],
    tenantId: string,
  ): Promise<
    Map<
      string,
      {
        document_id: string;
        chunk_index: number;
        chunk_text: string;
        section_path: string[];
        document_title: string;
        document_type: string;
      }
    >
  > {
    if (chunkIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT c.id, c.document_id, c.chunk_index, c.chunk_text, c.section_path,
             d.title AS document_title, d.document_type
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.id = ANY($1::uuid[]) AND c.tenant_id = $2::uuid
      `,
      [chunkIds, tenantId],
    );
    return new Map(rows.map((r: any) => [r.id, r]));
  }

  /** Optional document/date filters, starting positional params at `startIdx`. */
  private buildFilters(
    dto: SearchQueryDto,
    startIdx: number,
  ): { clause: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    let i = startIdx;

    if (dto.document_type) {
      parts.push(`d.document_type = $${i++}`);
      params.push(dto.document_type);
    }
    if (dto.tags && dto.tags.length > 0) {
      parts.push(`d.tags && $${i++}::text[]`);
      params.push(dto.tags);
    }
    if (dto.date_from) {
      parts.push(`c.created_at >= $${i++}`);
      params.push(dto.date_from);
    }
    if (dto.date_to) {
      parts.push(`c.created_at <= $${i++}`);
      params.push(dto.date_to);
    }

    return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
  }

  private snippet(text: string, max = 280): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
  }
}
