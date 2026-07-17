import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ParserService } from './parser.service';
import { ParsedDocument } from './parser.types';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures', 'banking');
const read = (name: string) => fs.readFile(path.join(FIXTURES, name));

describe('ParserService (W2 / CP2.1)', () => {
  const svc = new ParserService();

  describe('PDF parser', () => {
    it('extracts text + numbered-heading sections from the circular', async () => {
      const buf = await read('rbi-style-circular.pdf');
      const doc = await svc.parse({ buffer: buf, filename: 'rbi-style-circular.pdf' });
      expect(doc.text.length).toBeGreaterThan(200);
      expect(doc.metadata.page_count).toBeGreaterThanOrEqual(5);
      // at least one section with a multi-level numbered heading path
      const deep = doc.sections.find((s) => s.headingPath.length >= 2);
      expect(deep).toBeDefined();
      expect(doc.sections.some((s) => /Introduction/i.test(s.headingPath.join(' ')))).toBe(true);
    });
  });

  describe('DOCX parser', () => {
    it('rebuilds heading hierarchy from the CBS runbook', async () => {
      const buf = await read('cbs-eod-runbook.docx');
      const doc = await svc.parse({ buffer: buf, filename: 'cbs-eod-runbook.docx' });
      expect(doc.text.length).toBeGreaterThan(200);
      expect(doc.sections.some((s) => s.headingPath.length >= 2)).toBe(true);
    });
  });

  describe('TXT parser', () => {
    it('returns the whole text as one pathless section', async () => {
      const buf = await read('atm-cashout-sop.txt');
      const doc = await svc.parse({ buffer: buf, filename: 'atm-cashout-sop.txt' });
      expect(doc.sections).toHaveLength(1);
      expect(doc.sections[0].headingPath).toEqual([]);
      expect(doc.text).toContain('ATM CASH-OUT');
    });
  });

  describe('MD parser', () => {
    it('splits on ATX headings into a section hierarchy', async () => {
      const buf = await read('upi-recon-sop.md');
      const doc = await svc.parse({ buffer: buf, filename: 'upi-recon-sop.md' });
      expect(doc.sections.length).toBeGreaterThan(2);
      expect(doc.sections.some((s) => s.headingPath.length >= 2)).toBe(true);
    });
  });

  describe('CSV parser (table-aware)', () => {
    it('parses headers + rows from the CMDB csv', async () => {
      const buf = await read('cmdb-export.csv');
      const doc = await svc.parse({ buffer: buf, filename: 'cmdb-export.csv', documentType: 'cmdb_export' });
      expect(doc.metadata.cmdb_columns).toEqual([
        'ci_id', 'ci_name', 'ci_type', 'criticality_tier',
        'business_service', 'technical_owner', 'location',
      ]);
      expect((doc.metadata.table_rows as unknown[]).length).toBe(16);
    });
  });

  describe('XLSX parser (cmdb_export, table-aware)', () => {
    let doc: ParsedDocument;
    beforeAll(async () => {
      const buf = await read('cmdb-export.xlsx');
      doc = await svc.parse({ buffer: buf, filename: 'cmdb-export.xlsx', documentType: 'cmdb_export' });
    });
    it('preserves the CMDB column structure as cmdb_columns', () => {
      expect(doc.metadata.cmdb_columns).toEqual([
        'ci_id', 'ci_name', 'ci_type', 'criticality_tier',
        'business_service', 'technical_owner', 'location',
      ]);
    });
    it('emits structured rows including co-op-specific CI types', () => {
      const rows = doc.metadata.table_rows as Record<string, string>[];
      expect(rows.length).toBe(16);
      const ciTypes = new Set(rows.map((r) => r.ci_type));
      expect(ciTypes.has('sponsor_bank_link')).toBe(true);
      expect(ciTypes.has('npci_link')).toBe(true);
      // CIs mapped to the demonstrable business services
      const services = new Set(rows.map((r) => r.business_service));
      expect(services.has('core_banking')).toBe(true);
      expect(services.has('upi_imps')).toBe(true);
    });
  });

  describe('topology_diagram parser (best-effort)', () => {
    it('always flags needs_review and returns gracefully (label extraction is best-effort)', async () => {
      const buf = await read('branch-topology.pdf');
      const doc = await svc.parse({ buffer: buf, filename: 'branch-topology.pdf', documentType: 'topology_diagram' });
      // Hard guarantee: every topology doc is flagged for human review.
      expect(doc.metadata.needs_review).toBe(true);
      // Best-effort: labels is an array; may be empty for image-only diagrams.
      expect(Array.isArray(doc.metadata.extracted_labels)).toBe(true);
      expect(doc.sections).toEqual([]);
    });
  });

  describe('unsupported format', () => {
    it('rejects an unknown extension', async () => {
      await expect(
        svc.parse({ buffer: Buffer.from('x'), filename: 'evil.exe' }),
      ).rejects.toThrow(/Unsupported/);
    });
  });

  // ---- CP2.1 paste-back: first 500 chars per format + CMDB columns/rows ----
  it('PASTE-BACK: prints CP2.1 evidence', async () => {
    const head = (s: string) => s.slice(0, 500);
    const line = '─'.repeat(72);

    const pdf = await svc.parse({ buffer: await read('rbi-style-circular.pdf'), filename: 'rbi-style-circular.pdf' });
    const docx = await svc.parse({ buffer: await read('cbs-eod-runbook.docx'), filename: 'cbs-eod-runbook.docx' });
    const txt = await svc.parse({ buffer: await read('atm-cashout-sop.txt'), filename: 'atm-cashout-sop.txt' });
    const md = await svc.parse({ buffer: await read('upi-recon-sop.md'), filename: 'upi-recon-sop.md' });
    const xlsx = await svc.parse({ buffer: await read('cmdb-export.xlsx'), filename: 'cmdb-export.xlsx', documentType: 'cmdb_export' });
    const topo = await svc.parse({ buffer: await read('branch-topology.pdf'), filename: 'branch-topology.pdf', documentType: 'topology_diagram' });

    /* eslint-disable no-console */
    console.log(`\n${line}\nCP2.1 PASTE-BACK — first 500 chars of parsed text per format\n${line}`);
    console.log(`\n### PDF (rbi-style-circular.pdf, page_count=${pdf.metadata.page_count})\n${head(pdf.text)}`);
    console.log(`\n[PDF section_path sample] ${JSON.stringify(pdf.sections.find((s) => s.headingPath.length >= 2)?.headingPath)}`);
    console.log(`\n### DOCX (cbs-eod-runbook.docx)\n${head(docx.text)}`);
    console.log(`\n[DOCX section_path sample] ${JSON.stringify(docx.sections.find((s) => s.headingPath.length >= 2)?.headingPath)}`);
    console.log(`\n### TXT (atm-cashout-sop.txt)\n${head(txt.text)}`);
    console.log(`\n### MD (upi-recon-sop.md)\n${head(md.text)}`);
    console.log(`\n[MD section_path sample] ${JSON.stringify(md.sections.find((s) => s.headingPath.length >= 2)?.headingPath)}`);

    console.log(`\n${line}\nCMDB xlsx — cmdb_columns + first 2 rows (structured metadata)\n${line}`);
    console.log(`cmdb_columns: ${JSON.stringify(xlsx.metadata.cmdb_columns)}`);
    const rows = xlsx.metadata.table_rows as Record<string, string>[];
    console.log(`row_count: ${xlsx.metadata.row_count}`);
    console.log(`row[0]: ${JSON.stringify(rows[0])}`);
    console.log(`row[1]: ${JSON.stringify(rows[1])}`);

    console.log(`\n${line}\ntopology_diagram (branch-topology.pdf) — best-effort\n${line}`);
    console.log(`needs_review: ${topo.metadata.needs_review}  label_count: ${topo.metadata.label_count}`);
    console.log(`extracted_labels: ${JSON.stringify(topo.metadata.extracted_labels)}`);
    console.log(`${line}\n`);
    /* eslint-enable no-console */

    expect(true).toBe(true);
  });
});
