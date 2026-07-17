import pdfParse from 'pdf-parse';

/**
 * Thin resilience wrapper over pdf-parse.
 *
 * pdf-parse's bundled (old) pdfjs can intermittently reject a structurally-fine
 * PDF on a cold call with errors like "bad XRef entry", then succeed on retry.
 * A long-lived ingestion worker parses many PDFs, so we retry a few times before
 * giving up. The rejection is contained here (the caller's try/catch sees a
 * thrown Error, and no stray unhandled rejection escapes — verified at CP2.1).
 */
export async function extractPdfText(
  buffer: Buffer,
  attempts = 3,
): Promise<{ text: string; pageCount: number }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const data = await pdfParse(buffer);
      return {
        text: (data.text ?? '').replace(/\r\n/g, '\n'),
        pageCount: data.numpages,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
