/** BullMQ queue name for ingestion jobs (visible as `bull:knowledge-ingestion:*` in Redis). */
export const INGESTION_QUEUE = 'knowledge-ingestion';

/** Job name for a single document ingestion (parse → chunk → store). */
export const INGEST_DOCUMENT_JOB = 'ingest-document';

export interface IngestDocumentJob {
  documentId: string;
  tenantId: string;
}
