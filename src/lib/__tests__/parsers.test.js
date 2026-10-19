import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as jsonParser from '../parsers/jsonParser.js';
import * as xlsxParser from '../parsers/xlsxParser.js';
import * as docxParser from '../parsers/docxParser.js';
import { analyzeFiles, sanitizeFiles } from '../engine.js';

const entries = [
  { id: 'e1', type: 'email', original: 'john@acme.com', fakeValue: 'fake@x.com', enabled: true },
  { id: 'e2', type: 'custom', original: 'Project Phoenix', fakeValue: 'Project Alpha', enabled: true },
];

describe('jsonParser', () => {
  it('collects keys and string values and sanitizes both', async () => {
    const file = new File(
      [JSON.stringify({ 'john@acme.com': { note: 'Project Phoenix', n: 42 } })],
      'k.json',
      { type: 'application/json' },
    );
    expect(await jsonParser.detect(file)).toEqual(expect.arrayContaining(['john@acme.com', 'Project Phoenix']));
    const { blob } = await jsonParser.sanitize(file, entries);
    const out = JSON.parse(await blob.text());
    expect(Object.keys(out)).toEqual(['fake@x.com']);
    expect(out['fake@x.com'].note).toBe('Project Alpha');
    expect(out['fake@x.com'].n).toBe(42);
  });

  it('jiggles numeric leaves in place instead of stringifying them', async () => {
    const file = new File(
      [JSON.stringify({ balance: 1234.56, note: 'balance 1234.56', count: 42 })],
      'money.json',
      { type: 'application/json' },
    );
    const amountEntries = [
      { id: 'a1', type: 'amount', original: '1234.56', fakeValue: '987.65', enabled: true },
    ];
    expect(await jsonParser.detect(file)).toEqual(expect.arrayContaining(['1234.56']));
    const { blob } = await jsonParser.sanitize(file, amountEntries);
    const out = JSON.parse(await blob.text());
    expect(out.balance).toBe(987.65);
    expect(out.note).toBe('balance 987.65');
    expect(out.count).toBe(42);
  });

  it('reports invalid JSON with the file name', async () => {
    const file = new File(['{ not json'], 'bad.json', { type: 'application/json' });
    await expect(jsonParser.detect(file)).rejects.toThrow(/Invalid JSON in "bad.json"/);
  });
});

describe('xlsxParser (xlsx)', () => {
  it('sanitizes cells and keeps the sheet structure', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Email', 'Note'],
      ['john@acme.com', 'Project Phoenix'],
      ['other@acme.com', 'safe'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'People');
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const file = new File([buffer], 'people.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const texts = await xlsxParser.detect(file);
    expect(texts).toContain('john@acme.com');

    const { blob, name } = await xlsxParser.sanitize(file, entries);
    expect(name).toBe('people.sanitized.xlsx');
    const out = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(out.Sheets.People, { header: 1 });
    expect(rows[1]).toEqual(['fake@x.com', 'Project Alpha']);
    expect(rows[2][0]).toBe('other@acme.com');
  });

  it('jiggles amount cells and keeps the sheet shape', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['total'], ['$1,234.56']]), 'Totals');
    const file = new File([XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })], 'totals.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const amountEntries = [
      { id: 'a1', type: 'amount', original: '$1,234.56', fakeValue: '$1,411.80', enabled: true },
    ];
    expect(await xlsxParser.detect(file)).toContain('$1,234.56');
    const { blob } = await xlsxParser.sanitize(file, amountEntries);
    const out = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    expect(XLSX.utils.sheet_to_json(out.Sheets.Totals, { header: 1 })).toEqual([
      ['total'],
      ['$1,411.80'],
    ]);
  });

  it('exports CSV input back out as CSV', async () => {
    const file = new File(['email,name\njohn@acme.com,John\n'], 'people.csv', { type: 'text/csv' });
    const texts = await xlsxParser.detect(file);
    expect(texts.join(' ')).toContain('john@acme.com');
    const { blob, name } = await xlsxParser.sanitize(file, entries);
    expect(name).toBe('people.sanitized.csv');
    expect(await blob.text()).toContain('fake@x.com');
  });
});

describe('docxParser', () => {
  async function makeDocx() {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Email john@acme.com now</w:t></w:r>' +
        '<w:r><w:t>Project Phoenix</w:t></w:r></w:p></w:body></w:document>',
    );
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    return new File([buf], 'doc.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  it('extracts only text nodes (never XML tags)', async () => {
    const texts = await docxParser.detect(await makeDocx());
    expect(texts.join(' ')).toContain('john@acme.com');
    expect(texts.join(' ')).not.toContain('<w:t>');
  });

  it('rewrites document.xml and repackages a valid zip', async () => {
    const { blob, name } = await docxParser.sanitize(await makeDocx(), entries);
    expect(name).toBe('doc.sanitized.docx');
    const outZip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await outZip.file('word/document.xml').async('string');
    expect(xml).toContain('fake@x.com');
    expect(xml).toContain('Project Alpha');
    expect(xml).not.toContain('john@acme.com');
    expect(xml).toContain('<w:t>');
  });
});

describe('end-to-end via engine (docx)', () => {
  it('detects and downloads a sanitized docx', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:p><w:t>Secret Project Phoenix</w:t></w:p></w:document>');
    const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 's.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const found = await analyzeFiles([file], { rules: {}, customKeywords: ['Project Phoenix'] });
    // The keyword plus its derived "Phoenix" sub-string entry.
    expect(found).toHaveLength(2);
    expect(found.some((e) => e.original === 'Phoenix')).toBe(true);
    const [result] = await sanitizeFiles([file], found);
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const xml = await outZip.file('word/document.xml').async('string');
    expect(xml).not.toContain('Project Phoenix');
    expect(xml).not.toContain('Phoenix');
  });
});
