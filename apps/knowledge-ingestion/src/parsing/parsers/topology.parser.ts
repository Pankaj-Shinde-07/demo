import { ParsedDocument } from '../parser.types';
import { extractPdfText } from './pdf-extract';

/**
 * Topology-diagram parser (best-effort).
 *
 * Diagram exports (Visio/Lucidchart → PDF/image) carry little reliable prose.
 * v1 does best-effort extraction of the PDF text layer (shape labels) and
 * ALWAYS flags the document for human review (`needs_review = true`). Per
 * W2_BRIEF §3, OCR quality must not block the gate.
 *
 * NOTE (flagged): true raster OCR (e.g. tesseract.js) for image-only exports is
 * deferred beyond W2 — this extracts the embedded text layer only. Diagrams
 * with no text layer return empty labels but are still flagged for review.
 */
export async function parseTopology(buffer: Buffer): Promise<ParsedDocument> {
  let extractedText = '';
  let pageCount = 0;
  let extractionError: string | null = null;

  try {
    const data = await extractPdfText(buffer);
    extractedText = data.text.trim();
    pageCount = data.pageCount;
  } catch (err) {
    extractionError = (err as Error).message;
  }

  const labels = Array.from(
    new Set(
      extractedText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    ),
  );

  return {
    text: extractedText,
    sections: [],
    metadata: {
      format: 'topology_diagram',
      needs_review: true,
      ocr_attempted: extractionError === null,
      extracted_labels: labels,
      label_count: labels.length,
      page_count: pageCount,
      ...(extractionError ? { extraction_error: extractionError } : {}),
    },
  };
}
