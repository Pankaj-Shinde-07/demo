/**
 * Chunker types (W2 / CP2.2).
 *
 * A chunk maps 1:1 to a future `knowledge_chunks` row (W1 schema): it carries
 * `chunkText`, `tokenCount`, `sectionPath` (TEXT[]), and free-form `metadata`
 * (JSONB). Embeddings are NOT produced here — W3 fills them.
 */
export interface Chunk {
  /** 0-based position of this chunk within the document. */
  chunkIndex: number;
  /** The chunk's text content. */
  chunkText: string;
  /** Token count (cl100k_base approximation — see ChunkerService). */
  tokenCount: number;
  /** Heading path active where this chunk begins, e.g. ['1 Introduction','1.2 Scope']. */
  sectionPath: string[];
  /** Per-chunk structured metadata (e.g. cmdb row for row-oriented chunks). */
  metadata: Record<string, unknown>;
}

export interface ChunkOptions {
  /** Max tokens per chunk. Default 600 (W2_BRIEF §3). */
  maxTokens?: number;
  /** Token overlap between consecutive chunks. Default 100. */
  overlap?: number;
}
