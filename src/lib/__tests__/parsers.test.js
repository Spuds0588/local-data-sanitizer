import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as jsonParser from '../parsers/jsonParser.js';
import * as xlsxParser from '../parsers/xlsxParser.js';
import * as docxParser from '../parsers/docxParser.js';
import * as textParser from '../parsers/textParser.js';
import * as jsonlParser from '../parsers/jsonlParser.js';
import { analyzeFiles, sanitizeFiles } from '../engine.js';
import { DEFAULT_CONFIG } from '../rules.js';

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

  it('reports whole-dollar numbers under money keys, with their key', async () => {
    const file = new File(
      [JSON.stringify({ opening_balance: 4250, amount: 3200, count: 42, note: 'ID 4250' })],
      'statement.json',
      { type: 'application/json' },
    );
    const { segments, moneyNumbers } = await jsonParser.detectWithMeta(file);
    expect(segments).toEqual(expect.arrayContaining(['4250', '3200', '42']));
    expect(moneyNumbers).toEqual(
      expect.arrayContaining([
        { original: '4250', key: 'opening_balance', numeric: true },
        { original: '3200', key: 'amount', numeric: true },
      ]),
    );
    expect(moneyNumbers).toHaveLength(2);

    const amountEntries = [
      { id: 'a1', type: 'amount', original: '4250', fakeValue: '3712', enabled: true, numericOnly: true },
      { id: 'a2', type: 'amount', original: '3200', fakeValue: '2810', enabled: true, numericOnly: true },
    ];
    const { blob } = await jsonParser.sanitize(file, amountEntries);
    const out = JSON.parse(await blob.text());
    expect(out.opening_balance).toBe(3712);
    expect(out.amount).toBe(2810);
    expect(out.count).toBe(42);
    // Numeric-only entries must not rewrite the same digits inside strings.
    expect(out.note).toBe('ID 4250');
  });

  it('jiggles bare-number strings under a money key as strings', async () => {
    const file = new File([JSON.stringify({ balance: '4250' })], 'strings.json', {
      type: 'application/json',
    });
    const { moneyNumbers } = await jsonParser.detectWithMeta(file);
    expect(moneyNumbers).toEqual([{ original: '4250', key: 'balance', numeric: false }]);
    const entries = [
      { id: 'a1', type: 'amount', original: '4250', fakeValue: '3712', enabled: true },
    ];
    const { blob } = await jsonParser.sanitize(file, entries);
    expect(JSON.parse(await blob.text()).balance).toBe('3712');
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

describe('textParser', () => {
  const textFile = (text, name) => new File([text], name);

  it('types values from Markdown labels, including the colon-inside-bold form', async () => {
    const md = [
      '# Patient: Jane Doe',
      '',
      '**MRN:** MRN-77420',
      '**Date of birth:** January 30, 1988',
      '**Phone:** (303) 555-0164',
      '',
    ].join('\n');
    const file = textFile(md, 'notes.md');
    const entries = await analyzeFiles([file], DEFAULT_CONFIG);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'medicalId', original: 'MRN-77420' }),
        expect.objectContaining({ type: 'dob', original: 'January 30, 1988' }),
        expect.objectContaining({ type: 'name', original: 'Jane Doe' }),
      ]),
    );
    const [{ blob, name }] = await sanitizeFiles([file], entries);
    const out = await blob.text();
    expect(name).toBe('notes.sanitized.md');
    expect(out).toContain('**MRN:** ');
    expect(out).toContain('**Date of birth:** ');
    expect(out).not.toContain('MRN-77420');
    expect(out).not.toContain('January 30, 1988');
    expect(out.startsWith('# Patient: ')).toBe(true);
  });

  it('types Markdown table cells from their header row', async () => {
    const md = [
      '| Visit date | Physician | MRN |',
      '| --- | --- | --- |',
      '| 2024-01-09 | Dana Whitfield | MRN-77420 |',
      '',
    ].join('\n');
    const entries = await analyzeFiles([textFile(md, 'visits.md')], DEFAULT_CONFIG);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'name', original: 'Dana Whitfield' }),
        expect.objectContaining({ type: 'medicalId', original: 'MRN-77420' }),
      ]),
    );
  });

  it('types key=value pairs inside a log line', async () => {
    const log = '2024-02-03T14:22:05Z WARN auth user_id=USR-88213 phone=(617)555-0110\n';
    const entries = await analyzeFiles([textFile(log, 'access.log')], DEFAULT_CONFIG);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'recordId', original: 'USR-88213' }),
        expect.objectContaining({ type: 'phone', original: '(617)555-0110' }),
      ]),
    );
  });

  it('replaces a value split across an iCalendar fold and refolds to 75 chars', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20240315T140000Z',
      'ORGANIZER;CN=Camille Dubois:mailto:camille.dubois@northwind.example',
      'DESCRIPTION:Questions to camille.dubois@northwind.example about the',
      '  dial-in.',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    // Fold the address itself, the way a real calendar would.
    const folded = ics.replace('camille.dubois@northwind.example about', 'camille.dubois@northwind.exam\r\n ple about');
    const entries = await analyzeFiles([textFile(folded, 'invite.ics')], DEFAULT_CONFIG);
    expect(entries.some((entry) => entry.type === 'email' && entry.original === 'camille.dubois@northwind.example')).toBe(true);
    const [{ blob }] = await sanitizeFiles([textFile(folded, 'invite.ics')], entries);
    const out = await blob.text();
    expect(out).not.toContain('camille.dubois');
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
    expect(out.replace(/\r\n /g, '')).toContain('DTSTART:20240315T140000Z');
  });

  it('rewrites vCard N components consistently with FN', async () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Okafor;Nadia;Amara;;',
      'FN:Nadia Okafor',
      'END:VCARD',
      '',
    ].join('\r\n');
    const entries = await analyzeFiles([textFile(vcf, 'contact.vcf')], DEFAULT_CONFIG);
    const [{ blob }] = await sanitizeFiles([textFile(vcf, 'contact.vcf')], entries);
    const out = await blob.text();
    for (const original of ['Okafor', 'Nadia', 'Amara']) expect(out).not.toContain(original);
    const n = out.split(/\r?\n/).find((line) => line.startsWith('N:'));
    expect(n.slice(2).split(';')).toHaveLength(5);
    const fn = out.split(/\r?\n/).find((line) => line.startsWith('FN:'));
    const [first, last] = fn.slice(3).split(' ');
    // The structured family/given components are the same person as FN.
    const [family, given] = n.slice(2).split(';');
    expect(family).toBe(last);
    expect(given).toBe(first);
  });
});

describe('jsonlParser', () => {
  it('transforms JSON lines and falls back to text on a non-JSON line', async () => {
    const text = [
      '{"email":"a@b.com","balance":4250,"active":true}',
      'plain log line for a@b.com',
      '',
    ].join('\n');
    const file = new File([text], 'events.jsonl', { type: 'application/x-ndjson' });
    const entries = await analyzeFiles([file], DEFAULT_CONFIG);
    const [{ blob, name }] = await sanitizeFiles([file], entries);
    expect(name).toBe('events.sanitized.jsonl');
    const [jsonLine, logLine] = (await blob.text()).split('\n');
    const parsed = JSON.parse(jsonLine);
    expect(parsed.email).not.toBe('a@b.com');
    expect(parsed.active).toBe(true);
    expect(typeof parsed.balance).toBe('number');
    expect(logLine).not.toContain('a@b.com');
    expect(logLine.startsWith('plain log line for ')).toBe(true);
  });

  it('detects string values from each line', async () => {
    const text = '{"user":"Jane Doe"}\n{"user":"Robert Chen"}\n';
    const segments = await jsonlParser.detect(new File([text], 'u.jsonl'));
    expect(segments).toEqual(expect.arrayContaining(['Jane Doe', 'Robert Chen']));
  });
});

describe('end-to-end via engine (docx)', () => {
  it('detects and downloads a sanitized docx', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:p><w:t>Secret Project Phoenix — Phoenix</w:t></w:p></w:document>');
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
