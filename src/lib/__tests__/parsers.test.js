import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as jsonParser from '../parsers/jsonParser.js';
import * as xlsxParser from '../parsers/xlsxParser.js';
import * as docxParser from '../parsers/docxParser.js';
import * as textParser from '../parsers/textParser.js';
import * as jsonlParser from '../parsers/jsonlParser.js';
import * as htmlParser from '../parsers/htmlParser.js';
import * as emlParser from '../parsers/emlParser.js';
import * as pptxParser from '../parsers/pptxParser.js';
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
        '<w:r><w:t xml:space="preserve"> Project Phoenix</w:t></w:r></w:p></w:body></w:document>',
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

describe('cross-run text in OOXML', () => {
  const stripTags = (xml) => xml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

  async function splitDocx() {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document><w:body>' +
        // A bold first name and a regular surname: Word splits names this way
        // whenever part of the name was formatted separately.
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Jane</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> Doe</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> — </w:t></w:r>' +
        '<w:r><w:t>jane.d</w:t></w:r><w:r><w:t>oe@acme.example</w:t></w:r></w:p>' +
        '<w:p><w:t>Untouched tail</w:t></w:p>' +
        '</w:body></w:document>',
    );
    return new File([await zip.generateAsync({ type: 'nodebuffer' })], 'split.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  it('reads a DOCX paragraph as one value even when it spans runs', async () => {
    const { segments } = await docxParser.detectWithMeta(await splitDocx());
    expect(segments).toContain('Jane Doe — jane.doe@acme.example');
  });

  it('replaces across DOCX runs without dropping formatting or changing the paragraph shape', async () => {
    const file = await splitDocx();
    const { blob } = await docxParser.sanitize(file, [
      { type: 'name', original: 'Jane Doe', fakeValue: 'Maria Gonzalez', enabled: true },
      { type: 'email', original: 'jane.doe@acme.example', fakeValue: 'maria.gonzalez@example.test', enabled: true },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    const text = stripTags(xml);
    expect(text).not.toMatch(/Jane|Doe|jane\.d|acme\.example/);
    expect(text).toContain('Maria Gonzalez — maria.gonzalez@example.test');
    // Bold stays on the first name only, and the run is still a run.
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t>Maria</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve"> Gonzalez</w:t>');
    expect(xml.match(/<w:p>/g)).toHaveLength(2);
    expect(xml).toContain('<w:p><w:t>Untouched tail</w:t></w:p>');
  });

  it('scrubs split table cells end-to-end, not just the half a per-run scan sees', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<w:document><w:body><w:tbl><w:tr>' +
        '<w:tc><w:p><w:t>Full Name</w:t></w:p></w:tc><w:tc><w:p><w:t>Email</w:t></w:p></w:tc></w:tr><w:tr>' +
        '<w:tc><w:p><w:t>Priya</w:t><w:t xml:space="preserve"> Natarajan</w:t></w:p></w:tc>' +
        '<w:tc><w:p><w:t>priya.nata</w:t><w:t>rajan@acme.example</w:t></w:p></w:tc>' +
        '</w:tr></w:tbl></w:body></w:document>',
    );
    const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'split-table.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const found = await analyzeFiles([file], DEFAULT_CONFIG);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'name', original: 'Priya Natarajan' }),
        expect.objectContaining({ type: 'email', original: 'priya.natarajan@acme.example' }),
      ]),
    );
    const [{ blob }] = await sanitizeFiles([file], found);
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    const text = stripTags(await out.file('word/document.xml').async('string'));
    expect(text).not.toMatch(/Priya|Natarajan|priya\.nata|rajan@acme\.example/);
    expect(text).toContain('Full Name');
  });

  it('scrubs tracked deletions that are still stored in the file', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Signed by </w:t></w:r>' +
        '<w:del w:id="1" w:author="legal"><w:r><w:delText>Jane Doe</w:delText></w:r></w:del></w:p>' +
        '</w:body></w:document>',
    );
    const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'tracked.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(await docxParser.detect(file)).toContain('Signed by Jane Doe');
    const { blob } = await docxParser.sanitize(file, [
      { type: 'name', original: 'Jane Doe', fakeValue: 'Maria Gonzalez', enabled: true },
    ]);
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await out.file('word/document.xml').async('string');
    expect(xml).toContain('<w:del w:id="1" w:author="legal"><w:r><w:delText>Maria Gonzalez</w:delText>');
    expect(stripTags(xml)).not.toMatch(/Jane|Doe/);
  });

  it('replaces a PPTX title split across runs and keeps the placeholder', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
        '<p:txBody><a:p><a:r><a:rPr b="1"/><a:t>Priya</a:t></a:r>' +
        '<a:r><a:t xml:space="preserve"> Natarajan</a:t></a:r></a:p></p:txBody></p:sp>' +
        '</p:spTree></p:cSld></p:sld>',
    );
    const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'split.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const { typedValues } = await pptxParser.detectWithMeta(file);
    expect(typedValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'name', original: 'Priya Natarajan' })]),
    );

    const { blob } = await pptxParser.sanitize(file, [
      { type: 'name', original: 'Priya Natarajan', fakeValue: 'Nora Quinn', enabled: true },
    ]);
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    const slide = await out.file('ppt/slides/slide1.xml').async('string');
    expect(stripTags(slide)).toContain('Nora Quinn');
    expect(slide).not.toMatch(/Priya|Natarajan/);
    expect(slide).toContain('<a:rPr b="1"/><a:t>Nora</a:t>');
    expect(slide).toContain('<p:ph type="title"/>');
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

describe('htmlParser', () => {
  const html = `<!doctype html><html><body>
    <h1>Team</h1>
    <table><thead><tr><th>Full Name</th><th>Email</th></tr></thead>
      <tbody>
        <tr><td>Jane Doe</td><td>jane@acme.example</td></tr>
        <tr><td>Robert Chen</td><td>robert@acme.example</td></tr>
      </tbody></table>
    <p>Questions: <a href="mailto:jane@acme.example">jane@acme.example</a></p>
  </body></html>`;

  it('types cells from a header row', async () => {
    const { typedValues, segments } = await htmlParser.detectWithMeta(
      new File([html], 'team.html', { type: 'text/html' }),
    );
    expect(typedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ original: 'Jane Doe', type: 'name' }),
        expect.objectContaining({ original: 'robert@acme.example', type: 'email' }),
      ]),
    );
    expect(segments).toContain('jane@acme.example');
  });

  it('rewrites visible text and attribute values but keeps the markup', async () => {
    const { blob } = await htmlParser.sanitize(
      new File([html], 'team.html', { type: 'text/html' }),
      [
        { type: 'name', original: 'Jane Doe', fakeValue: 'Nora Quinn', enabled: true },
        { type: 'email', original: 'jane@acme.example', fakeValue: 'nora@example.test', enabled: true },
      ],
    );
    const out = await blob.text();
    expect(out).toContain('<table>');
    expect(out).toContain('<th>Full Name</th>');
    expect(out).toContain('<td>Robert Chen</td>');
    expect(out).toContain('<td>Nora Quinn</td>');
    expect(out).toContain('<a href="mailto:nora@example.test">nora@example.test</a>');
    expect(out).not.toContain('jane@acme.example');
  });
});

describe('emlParser', () => {
  const attachment = 'FAKE-PDF-BYTES-0123456789';
  const htmlPart = '<p>jane@acme.example</p>';
  const message = [
    'From: "Jane Doe" <jane@acme.example>',
    'To: ops@acme.example',
    'Subject: statement',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hi, mail jane@acme.example or call 020 7946 0958.',
    '--b1',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlPart).toString('base64'),
    '--b1',
    'Content-Type: application/pdf; name="jane@acme.example.pdf"',
    'Content-Disposition: attachment; filename="jane@acme.example.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(attachment).toString('base64'),
    '--b1--',
    '',
  ].join('\r\n');

  const entries = [
    { type: 'name', original: 'Jane Doe', fakeValue: 'Nora Quinn', enabled: true },
    { type: 'email', original: 'jane@acme.example', fakeValue: 'nora@example.test', enabled: true },
    { type: 'phone', original: '020 7946 0958', fakeValue: '020 7946 0999', enabled: true },
  ];

  it('decodes quoted-printable and base64 before typing, and keeps the attachment bytes', async () => {
    const segments = await emlParser.detect(new File([message], 'mail.eml', { type: 'message/rfc822' }));
    expect(segments.join('\n')).toContain('jane@acme.example');
    expect(segments.join('\n')).toContain(htmlPart);
    expect(segments.join('\n')).not.toContain(attachment);

    const { blob } = await emlParser.sanitize(
      new File([message], 'mail.eml', { type: 'message/rfc822' }),
      entries,
    );
    const out = await blob.text();
    expect(out).not.toContain('jane@acme.example');
    expect(out).not.toContain('020 7946 0958');
    expect(out).toContain('nora@example.test');
    expect(out).toContain('Nora Quinn');
    // Multipart structure survives: boundary, encodings, decoded HTML part.
    expect(out).toContain('boundary="b1"');
    expect(out).toContain('Content-Transfer-Encoding: base64');
    expect(out).toContain(Buffer.from('<p>nora@example.test</p>').toString('base64'));
    // The attachment is left byte-for-byte alone, including its filename header
    // except for the scrubbed filename value.
    expect(out).toContain(Buffer.from(attachment).toString('base64'));
    expect(out).toContain('filename="nora@example.test.pdf"');
    expect(out.endsWith('--b1--\r\n')).toBe(true);
  });
});

describe('pptxParser', () => {
  async function deck() {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
        '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
        '<p:txBody><a:p><a:r><a:t>Priya Natarajan</a:t></a:r></a:p></p:txBody></p:sp>' +
        '<a:tbl><a:tr><a:tc><a:t>Full Name</a:t></a:tc><a:tc><a:t>Email</a:t></a:tc></a:tr>' +
        '<a:tr><a:tc><a:t>Robert Chen</a:t></a:tc><a:tc><a:t>robert@acme.example</a:t></a:tc></a:tr></a:tbl>' +
        '</p:spTree></p:cSld></p:sld>',
    );
    zip.file(
      'ppt/notesSlides/notesSlide1.xml',
      '<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Call 020 7946 0958</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
    );
    return new File([await zip.generateAsync({ type: 'nodebuffer' })], 'deck.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
  }

  it('types the title placeholder and table cells', async () => {
    const { typedValues, segments } = await pptxParser.detectWithMeta(await deck());
    expect(typedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ original: 'Priya Natarajan', type: 'name' }),
        expect.objectContaining({ original: 'robert@acme.example', type: 'email' }),
      ]),
    );
    // Speaker notes are read too.
    expect(segments.join('\n')).toContain('020 7946 0958');
  });

  it('rewrites text runs and keeps the package structure', async () => {
    const file = await deck();
    const { blob, name } = await pptxParser.sanitize(file, [
      { type: 'name', original: 'Priya Natarajan', fakeValue: 'Nora Quinn', enabled: true },
      { type: 'name', original: 'Robert Chen', fakeValue: 'Miles Avery', enabled: true },
      { type: 'email', original: 'robert@acme.example', fakeValue: 'miles@example.test', enabled: true },
      { type: 'phone', original: '020 7946 0958', fakeValue: '020 7946 0999', enabled: true },
    ]);
    expect(name).toBe('deck.sanitized.pptx');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slide = await zip.file('ppt/slides/slide1.xml').async('string');
    expect(slide).toContain('<a:t>Nora Quinn</a:t>');
    expect(slide).toContain('<a:t>Miles Avery</a:t>');
    expect(slide).toContain('<a:t>Full Name</a:t>');
    expect(slide).not.toContain('robert@acme.example');
    expect(slide).toContain('<p:ph type="title"/>');
    const notes = await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');
    expect(notes).toContain('020 7946 0999');
    expect(notes).not.toContain('020 7946 0958');
  });
});

describe('textParser XML and SQL typing', () => {
  const xml = `<?xml version="1.0"?>
<Export><Customer id="CUS-88213">
  <FirstName>Aisha</FirstName>
  <Company>Acme &amp; Sons</Company>
  <Address line1="18 Marsh Lane" city="Manchester"/>
  <Note>Acme &amp; Sons called</Note>
</Customer></Export>`;

  it('types XML elements and attributes from their names', async () => {
    const { typedValues } = await textParser.detectWithMeta(new File([xml], 'export.xml'));
    expect(typedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ original: 'Aisha', type: 'name' }),
        expect.objectContaining({ original: '18 Marsh Lane', type: 'address' }),
        expect.objectContaining({ original: 'Manchester', type: 'city' }),
      ]),
    );
  });

  it('keeps XML markup intact and escapes the fake value', async () => {
    const { blob } = await textParser.sanitize(new File([xml], 'export.xml'), [
      { type: 'name', original: 'Aisha', fakeValue: 'Nora', enabled: true },
      { type: 'organization', original: 'Acme &amp; Sons', fakeValue: 'Bell & Co', enabled: true },
    ]);
    const out = await blob.text();
    expect(out).toContain('<FirstName>Nora</FirstName>');
    expect(out).toContain('<Address line1="18 Marsh Lane" city="Manchester"/>');
    expect(out).not.toContain('Aisha');
    // The raw `&` in the fake is escaped so the document still parses.
    expect(out).toContain('Bell &amp; Co called');
    expect(out).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#)/);
  });

  const sql = [
    'CREATE TABLE `customers` (',
    '  `customer_id` int NOT NULL,',
    '  `first_name` varchar(40) DEFAULT NULL,',
    '  `last_name` varchar(40) DEFAULT NULL,',
    '  `email` varchar(80) DEFAULT NULL,',
    '  `annual_salary` decimal(10,2) DEFAULT NULL,',
    '  PRIMARY KEY (`customer_id`)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    "INSERT INTO `customers` VALUES (1,'Dara','O''Brien','dara@example.ie',92500.00);",
  ].join('\n');

  it('takes column order from CREATE TABLE when INSERT omits the list', async () => {
    const { typedValues } = await textParser.detectWithMeta(new File([sql], 'dump.sql'));
    expect(typedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ original: 'Dara', type: 'name' }),
        expect.objectContaining({ original: "O'Brien", type: 'name' }),
        expect.objectContaining({ original: 'dara@example.ie', type: 'email' }),
        expect.objectContaining({ original: '92500.00', type: 'amount' }),
      ]),
    );
  });

  it('re-escapes apostrophes in SQL literals', async () => {
    const { blob } = await textParser.sanitize(new File([sql], 'dump.sql'), [
      { type: 'name', original: "O'Brien", fakeValue: "Nora O'Neil", enabled: true },
      { type: 'email', original: 'dara@example.ie', fakeValue: 'nora@example.test', enabled: true },
    ]);
    const out = await blob.text();
    expect(out).toContain("'Nora O''Neil'");
    expect(out).toContain("'nora@example.test'");
    expect(out).not.toContain("O''Brien");
    expect(out).toContain('CREATE TABLE `customers` (');
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
