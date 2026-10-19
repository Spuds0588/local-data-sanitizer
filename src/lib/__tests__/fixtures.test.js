// End-to-end privacy test over a committed corpus of realistic exports.
//
// Every fixture carries a manifest of the synthetic secrets it contains. The
// test runs the whole corpus through the real parser pipeline, re-extracts the
// sanitized output, and fails on any surviving value. Structure checks keep the
// fix honest: a sanitizer that blanked the files would not pass.

import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { faker } from '@faker-js/faker';
import { analyzeFiles, sanitizeFiles } from '../engine.js';
import { DEFAULT_CONFIG } from '../rules.js';
import { escapeRegExp } from '../text.js';
import { parseCsv } from '../csv.js';
import { parseMrz } from '../mrz.js';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const TIMEOUT = 60_000;

let manifest;
let entries;
const outputs = new Map();

/**
 * Text as a reader sees it: runs inside a paragraph are joined, so a name or
 * email split over several runs is still one string for the leak check.
 */
function paragraphText(xml, paragraphRe, runRe) {
  const out = [];
  for (const paragraph of xml.matchAll(paragraphRe)) {
    const text = [...paragraph[1].matchAll(runRe)].map((run) => run[1]).join('');
    if (text.trim()) out.push(text.trim());
  }
  return out;
}

function sheetText(wb) {
  const parts = [...wb.SheetNames];
  for (const name of wb.SheetNames) {
    const ref = wb.Sheets[name]['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = wb.Sheets[name][XLSX.utils.encode_cell({ r, c })];
        if (cell) parts.push(String(cell.w ?? cell.v ?? ''));
      }
    }
  }
  return parts.join('\n');
}

async function extract(result) {
  const { name, blob } = result;
  if (/\.json$/i.test(name)) {
    return { name, kind: 'json', text: await blob.text() };
  }
  if (/\.csv$/i.test(name)) {
    // Read CSV as exact UTF-8 text; XLSX's CSV reader would re-guess types.
    const text = await blob.text();
    return { name, kind: 'csv', text, rows: parseCsv(text) };
  }
  if (/\.tsv$/i.test(name)) {
    const text = await blob.text();
    return { name, kind: 'tsv', text, rows: parseCsv(text, '\t') };
  }
  if (/\.jsonl$/i.test(name)) {
    const text = await blob.text();
    return { name, kind: 'jsonl', text, lines: text.split(/\r?\n/).filter((line) => line.trim()) };
  }
  if (/\.xlsx$/i.test(name)) {
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true, cellText: true });
    return { name, kind: 'sheet', text: sheetText(wb), wb };
  }
  if (/\.pptx$/i.test(name)) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const parts = Object.keys(zip.files).filter((part) => /^ppt\/(slides|notesSlides)\/.+\.xml$/.test(part));
    const texts = [];
    for (const part of parts) {
      const xml = await zip.file(part).async('string');
      texts.push(...paragraphText(xml, /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g, /<a:t\b[^>]*>([^<]*)<\/a:t>/g));
    }
    return { name, kind: 'pptx', text: texts.join('\n'), parts: parts.length };
  }
  if (/\.docx$/i.test(name)) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const entry = zip.file('word/document.xml');
    expect(entry, `${name} must still be a valid docx`).toBeTruthy();
    const xml = await entry.async('string');
    const text = paragraphText(xml, /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, /<w:t\b[^>]*>([^<]*)<\/w:t>/g);
    return { name, kind: 'docx', text: text.join('\n'), xml };
  }
  return { name, kind: 'text', text: await blob.text() };
}

function snippet(text, index, radius = 45) {
  return text
    .slice(Math.max(0, index - radius), Math.min(text.length, index + radius))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grouped and ungrouped spellings of an amount, with digit boundaries. */
function numberRegExp(value) {
  const raw = String(value).trim();
  const numeric = Number(raw.replace(/[^0-9.-]/g, ''));
  const decimals = (raw.split('.')[1] || '').replace(/\D/g, '').length;
  const fixed = numeric.toFixed(decimals);
  const [int, frac] = fixed.replace('-', '').split('.');
  const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const forms = new Set();
  if (decimals > 0) {
    forms.add(`${int}.${frac}`);
    forms.add(`${group(int)}.${frac}`);
  } else {
    forms.add(int);
    forms.add(group(int));
  }
  const suffix = decimals > 0 ? '' : '(?:\\.\\d{2})?';
  return new RegExp(`(?<![\\d.,])(?:${[...forms].map(escapeRegExp).join('|')})${suffix}(?![\\d,])`);
}

function textRegExp(value) {
  const escaped = escapeRegExp(value);
  // Short standalone tokens ("Jane") need word boundaries; emails, addresses
  // and IDs are distinctive enough as plain substrings.
  return /^[A-Za-z]+$/.test(value) ? new RegExp(`\\b${escaped}\\b`, 'i') : new RegExp(escaped, 'i');
}

/** Decode a quoted-printable part back to text (for the encoded-email test). */
function decodeQuotedPrintable(text) {
  const input = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(input.slice(i + 1, i + 3))) {
      bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(input.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The body of one MIME part (everything after its header block). */
function mimePartBody(piece) {
  const index = piece.search(/\r?\n\r?\n/);
  return index === -1 ? piece : piece.slice(index).replace(/^\r?\n\r?\n/, '');
}

beforeAll(async () => {
  faker.seed(20_240_201);
  manifest = JSON.parse(await fs.readFile(path.join(FIXTURES, 'manifest.json'), 'utf8'));

  const files = [];
  for (const file of manifest.files) {
    const buffer = await fs.readFile(path.join(FIXTURES, file.name));
    files.push(new File([buffer], file.name));
  }

  entries = await analyzeFiles(files, DEFAULT_CONFIG);
  const results = await sanitizeFiles(files, entries);
  for (let i = 0; i < results.length; i += 1) {
    outputs.set(manifest.files[i].name, await extract(results[i]));
  }
}, TIMEOUT);

describe('sensitive-data fixture corpus', () => {
  it('reports a detector for every category the corpus exercises', () => {
    const types = new Set(entries.map((entry) => entry.type));
    for (const type of [
      'email', 'phone', 'ssn', 'creditCard', 'creditCardPartial', 'amount',
      'account', 'routing', 'iban', 'name', 'dob', 'address', 'city',
      'postalCode', 'taxId', 'passport', 'license', 'ipAddress', 'password',
      'apiKey', 'recordId', 'medicalId', 'profileUrl', 'organization',
    ]) {
      expect(types, `no "${type}" entry was produced`).toContain(type);
    }
  }, TIMEOUT);

  it('leaves no manifest secret in any sanitized output', () => {
    const failures = [];
    for (const file of manifest.files) {
      const output = outputs.get(file.name);
      expect(output, `missing sanitized output for ${file.name}`).toBeTruthy();
      for (const secret of file.secrets) {
        const pattern = secret.match === 'number' ? numberRegExp(secret.value) : textRegExp(secret.value);
        const found = pattern.exec(output.text);
        if (found) {
          failures.push(
            `${output.name}: ${secret.match} "${secret.value}" survived near "${snippet(output.text, found.index)}"`,
          );
          continue;
        }
        // A cell sits between commas, which the number matcher's lookbehind
        // rejects; compare parsed rows as well so a number cannot hide there.
        if (secret.match === 'number' && output.rows) {
          const target = Number(String(secret.value).replace(/[^0-9.-]/g, ''));
          const cell = output.rows.flat().find((value) => {
            const text = String(value).trim();
            return text !== '' && Number(text.replace(/[^0-9.-]/g, '')) === target && /\d/.test(text);
          });
          if (cell !== undefined) {
            failures.push(`${output.name}: number "${secret.value}" survived in cell "${cell}"`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, TIMEOUT);

  it('keeps the JSON export parseable, typed and internally consistent', () => {
    const output = outputs.get('user-export.json');
    const data = JSON.parse(output.text);
    expect(data.users).toHaveLength(4);
    expect(data.generated_at).toBe('2024-02-01T09:15:00Z');
    expect(data.users[0].is_active).toBe(true);
    expect(data.users[2].is_active).toBe(false);
    // A whole-dollar balance must stay a number, not become a string.
    expect(typeof data.users[0].balance).toBe('number');
    expect(data.users[0].balance).not.toBe(4250);
    expect(typeof data.users[0].credit_limit).toBe('number');
    expect(data.users[0].credit_limit).not.toBe(25000);
    // A numeric account number must stay numeric and still look like an account.
    expect(typeof data.users[0].account_number).toBe('number');
    expect(String(data.users[0].account_number)).toMatch(/^\d{9}$/);
    expect(data.users[0].account_number).not.toBe(884201553);
    // Address shape survives, and schema keys are not renamed by a name entry
    // that happens to share a word with them ("City" vs `city`).
    expect(Object.keys(data.users[0].address)).toEqual(['line1', 'city', 'state', 'postal_code']);
    expect(data.users[0].address.line1).toMatch(/^\d+\s/);
    expect(data.users[0].address.state).toBe('IL');

    // A phone keeps the original's punctuation shape (bare stays bare, +1 stays
    // +1), so CSV cells and prose signatures still read the same way.
    const shape = (value) => String(value).replace(/\d/g, '9');
    for (const entry of entries.filter((item) => item.type === 'phone')) {
      expect(shape(entry.fakeValue)).toBe(shape(entry.original));
      expect(entry.fakeValue).not.toBe(entry.original);
    }
  }, TIMEOUT);

  it('keeps bank rows and money formatting while replacing their contents', () => {
    const { rows } = outputs.get('bank-transactions.csv');
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual([
      'Date', 'Description', 'Payee', 'Account Number', 'Routing Number',
      'Card Number', 'Debit', 'Credit', 'Balance', 'Reference',
    ]);
    expect(rows[1][3]).toMatch(/^\d{12}$/); // leading-zero account keeps its width
    for (const row of rows.slice(1)) {
      for (const index of [6, 7, 8]) {
        if (row[index]) expect(String(row[index])).toMatch(/^-?\d+\.\d{2}$/);
      }
    }
  }, TIMEOUT);

  it('preserves the workbook layout, formats and non-sensitive columns', () => {
    const { wb } = outputs.get('accounts-receivable.xlsx');
    expect(wb.SheetNames).toEqual(['Invoices', 'Customers']);

    const invoices = XLSX.utils.sheet_to_json(wb.Sheets.Invoices, { header: 1, raw: true });
    expect(invoices).toHaveLength(7);
    expect(invoices[0][0]).toBe('Invoice #');
    expect(invoices[1][0]).toBe('INV-1001');
    expect(invoices[6][0]).toBe('INV-1006');
    expect(typeof invoices[1][6]).toBe('number');
    expect(wb.Sheets.Invoices.G2.z).toBe('$#,##0.00');
    expect(wb.Sheets.Invoices.H2.z).toBe('$#,##0.00');

    const customers = XLSX.utils.sheet_to_json(wb.Sheets.Customers, { header: 1, raw: true });
    expect(customers).toHaveLength(5);
    expect(customers[0][1]).toBe('Full Name');
    expect(customers[1][4]).toMatch(/^\d+\s/);
    expect(typeof customers[1][8]).toBe('number');
  }, TIMEOUT);

  it('keeps UTF-8 text intact in CSV output', () => {
    const output = outputs.get('support-tickets.csv');
    expect(output.text).toContain('—');
    expect(output.text).not.toContain('Ã');
  }, TIMEOUT);

  it('keeps the DOCX a valid document with its table intact', () => {
    const { xml, text } = outputs.get('kyc-profile.docx');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:sectPr>');
    expect(xml).toContain('Beneficiary');
    expect(xml).toContain('Share');
    // Label/value spacing survives the amount rewrite.
    expect(text).toMatch(/Annual income: \$[\d,]+\.\d{2}/);
  }, TIMEOUT);

  it('exports the PDF as readable text with its labels', () => {
    const output = outputs.get('statement.pdf');
    expect(output.name).toBe('statement.sanitized.txt');
    expect(output.text).toContain('--- Page 1 ---');
    expect(output.text).toContain('Account Holder:');
    expect(output.text).toMatch(/Opening Balance: \$[\d,]+\.\d{2}/);
    expect(output.text).toMatch(/Closing Balance: \$[\d,]+\.\d{2}/);
  }, TIMEOUT);

  it('links a masked card fragment to the full card without keeping its digits', () => {
    const full = entries.find(
      (entry) => entry.type === 'creditCard' && /^4111[ -]?1111[ -]?1111[ -]?1111$/.test(entry.original),
    );
    const partial = entries.find((entry) => entry.type === 'creditCardPartial');
    expect(full).toBeTruthy();
    expect(partial).toBeTruthy();
    const digits = (value) => String(value).replace(/\D/g, '').slice(-4);
    expect(digits(partial.fakeValue)).toBe(digits(full.fakeValue));
  }, TIMEOUT);

  it('uses one fake across every file for the same account number', () => {
    const account = entries.find((entry) => entry.type === 'account' && entry.original === '884201553');
    expect(account).toBeTruthy();
    const filesWithFake = [...outputs.values()].filter((output) => output.text.includes(account.fakeValue));
    expect(filesWithFake.length).toBeGreaterThanOrEqual(3);
  }, TIMEOUT);

  it('keeps the TSV payroll grid: tabs, widths and money columns', () => {
    const { text, rows } = outputs.get('payroll-register.tsv');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual([
      'Employee ID', 'First Name', 'Last Name', 'Work Email', 'SSN', 'Date of Birth',
      'Home Address', 'City', 'State', 'ZIP', 'Bank Account', 'Routing Number',
      'Annual Salary', 'Notes',
    ]);
    for (const row of rows.slice(1)) {
      expect(row).toHaveLength(14);
      // A bank account keeps its width and digits-only shape.
      expect(row[10]).toMatch(/^\d{9}$/);
      // An unnamed person is still a two-token name in the right columns.
      expect(row[1]).toMatch(/^[A-Z]/);
      expect(row[2]).toMatch(/^[A-Z]/);
      expect(row[9]).toMatch(/^\d{5}$/);
      expect(row[13]).toMatch(/^Emergency contact: |^Reach |^Payroll contact: /);
    }
  }, TIMEOUT);

  it('keeps the JSONL event stream one object per line and typed', () => {
    const { lines } = outputs.get('crm-events.jsonl');
    expect(lines).toHaveLength(4);
    const events = lines.map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual([
      'contact.created', 'note.added', 'deal.updated', 'contact.updated',
    ]);
    // Timestamps, booleans and fixed vocabulary must not be touched.
    expect(events.map((event) => event.at)).toEqual([
      '2024-02-05T11:02:00Z', '2024-02-05T11:09:00Z',
      '2024-02-06T08:31:00Z', '2024-02-06T08:33:00Z',
    ]);
    expect(events[2].stage).toBe('negotiation');
    expect(events[3].field).toBe('balance');
    // Money keeps its JSON number type.
    expect(typeof events[2].amount).toBe('number');
    expect(events[2].amount).not.toBe(4800);
    expect(typeof events[3].balance).toBe('number');
    // The nested contact keeps its schema, with the ID rewritten in place.
    const contact = events[0].contact;
    expect(Object.keys(contact)).toEqual([
      'id', 'full_name', 'first_name', 'last_name', 'email', 'phone', 'date_of_birth',
      'ssn', 'company', 'linkedin', 'address', 'credit_limit', 'balance',
    ]);
    expect(contact.id).toMatch(/^CNT-\d{4}$/);
    expect(contact.address.state).toBe('MA');
    expect(events[1].body).toMatch(/^Left voicemail on [\d()-]+\. Backup number [\d()-]+\. SSN on file \d{3}-\d{2}-\d{4}\.$/);
  }, TIMEOUT);

  const linesOf = (text) => text.split(/\r?\n/);
  const NAME = "[A-Z][A-Za-z'’-]+(?: [A-Z][A-Za-z'’-]+)+";

  it('keeps the email a valid multipart message with its headers', () => {
    const { text } = outputs.get('support-thread.eml');
    // CRLF line endings, MIME boundary and both parts survive intact.
    expect(text).toContain('\r\n');
    expect(text.startsWith('From: ')).toBe(true);
    expect(text).toContain('Content-Type: multipart/alternative; boundary="----=_Part_1234"');
    expect(text).toContain('------=_Part_1234--');
    const lines = linesOf(text);
    expect(lines.filter((line) => /^Content-Type: text\/(plain|html); charset="utf-8"$/.test(line))).toHaveLength(2);
    expect(lines.some((line) => /^From: "[^"]+" <[^@\s]+@[^>]+>$/.test(line))).toBe(true);
    expect(lines.some((line) => /^To: "[^"]+" <[^@\s]+@[^>]+>$/.test(line))).toBe(true);
    expect(lines.some((line) => /^Subject: Re: refund for card ending in \d{4}$/.test(line))).toBe(true);
    // The signature and the tel: link keep their shape.
    expect(text).toMatch(/\r\nThanks,\r\n.+\r\n/);
    expect(text).toMatch(/<a href="tel:\d{3}-\d{3}-\d{4}">\d{3}-\d{3}-\d{4}<\/a>/);
  }, TIMEOUT);

  it('keeps the vCard property structure and field order', () => {
    const { text } = outputs.get('contacts.vcf');
    expect(text.startsWith('BEGIN:VCARD')).toBe(true);
    expect(text.trimEnd().endsWith('END:VCARD')).toBe(true);
    // Long values may be folded for transport; unfold for property checks.
    const lines = linesOf(text.replace(/\r\n /g, '')).filter(Boolean);
    expect(lines).toContain('VERSION:3.0');
    // N has five semicolon-separated components, like the original.
    const n = lines.find((line) => line.startsWith('N:'));
    const components = n.slice(2).split(';');
    expect(components).toHaveLength(5);
    expect(components.slice(0, 3).every(Boolean)).toBe(true);
    expect(lines.some((line) => new RegExp(`^FN:${NAME}$`).test(line))).toBe(true);
    expect(lines.some((line) => /^ORG:.+/.test(line))).toBe(true);
    expect(lines.some((line) => /^TEL;TYPE=CELL:\+1 \(\d{3}\) \d{3}-\d{4}$/.test(line))).toBe(true);
    expect(lines.some((line) => /^EMAIL;TYPE=WORK:[^@\s]+@[^\s]+$/.test(line))).toBe(true);
    expect(lines.some((line) => /^BDAY:\d{4}-\d{2}-\d{2}$/.test(line))).toBe(true);
    expect(text).not.toContain('BDAY:1990-03-03');
    expect(lines.some((line) => /^ADR;TYPE=HOME:;;[^;]+;[^;]+;[A-Z]{2};\d{5};[A-Z]+$/.test(line))).toBe(true);
    expect(lines.some((line) => /^URL:https:\/\/www\.linkedin\.com\/in\/[^\s]+$/.test(line))).toBe(true);
  }, TIMEOUT);

  it('keeps the calendar valid, folded and event-time intact', () => {
    const { text } = outputs.get('team-calendar.ics');
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).toContain('DTSTART:20240315T140000Z');
    expect(text).toContain('DTEND:20240315T150000Z');
    expect(text).toContain('UID:7f2c1d9e-4a6b-4c8d-9e0f-1a2b3c4d5e6f');
    const lines = linesOf(text).filter(Boolean);
    // Property assertions run on the unfolded content: a long value may be
    // folded for transport, which does not change the calendar.
    const logical = linesOf(text.replace(/\r\n /g, '')).filter(Boolean);
    expect(logical.some((line) => new RegExp(`^SUMMARY:Benefits review with ${NAME}$`).test(line))).toBe(true);
    expect(logical.some((line) => /^ORGANIZER;CN=[^:]+:mailto:[^@\s]+@[^\s]+$/.test(line))).toBe(true);
    expect(logical.some((line) => /^ATTENDEE;CN=[^;]+;ROLE=REQ-PARTICIPANT:mailto:[^@\s]+@[^\s]+$/.test(line))).toBe(true);
    expect(logical.some((line) => /^LOCATION:\d+ .+, [^,]+, [A-Z]{2} \d{5}$/.test(line))).toBe(true);
    // The long DESCRIPTION is folded, and every physical line stays <= 75 chars.
    expect(text).toMatch(/\r\n /);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(75);
    expect(text.replace(/\r\n /g, '')).toMatch(/Questions to [^\s]+@[^\s]+\./);
  }, TIMEOUT);

  it('keeps the Markdown layout: heading, bold labels and pipe table', () => {
    const { text } = outputs.get('patient-notes.md');
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toMatch(new RegExp(`^# Patient: ${NAME}$`));
    expect(text).not.toContain('Aisha Rahman');
    for (const label of ['MRN', 'Member ID', 'Date of birth', 'Phone', 'Email', 'Address', 'Payer', 'Primary care']) {
      expect(text, `${label} label must survive`).toContain(`**${label}:**`);
    }
    expect(text).toMatch(/^\*\*Date of birth:\*\* [A-Z][a-z]+ \d{1,2}, \d{4}$/m);
    expect(text).toMatch(/^\*\*MRN:\*\* [A-Z]{3}-\d{5}$/m);
    const table = lines.filter((line) => line.startsWith('|'));
    expect(table).toHaveLength(4);
    for (const row of table) expect(row.split('|')).toHaveLength(6);
    // The prose still names the same (fake) patient as the heading, by the
    // first name the heading established.
    const headingName = /^# Patient: (.+)$/m.exec(text)[1];
    expect(text).toContain(`${headingName.split(' ')[0]} presented for a routine follow-up.`);
  }, TIMEOUT);

  it('keeps log lines parseable: timestamps, status codes and bearer prefix', () => {
    const { text } = outputs.get('access.log');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/^\d+\.\d+\.\d+\.\d+ - - \[03\/Feb\/2024:14:22:00 \+0000\] "POST \/api\/login HTTP\/1\.1" 200 512 /);
    for (const stamp of [
      '2024-02-03T14:22:05Z', '2024-02-03T14:22:09Z', '2024-02-03T14:22:11Z',
      '2024-02-03T14:22:12Z', '2024-02-03T14:23:40Z',
    ]) {
      expect(text, `${stamp} must not be jiggled or shifted`).toContain(stamp);
    }
    expect(text).toContain('currency=USD');
    expect(text).toContain('Authorization: Bearer ');
    expect(lines[1]).toMatch(/^2024-02-03T14:22:05Z WARN auth user_id=[A-Z]{3}-\d{5} email=\S+ ip=\d+\.\d+\.\d+\.\d+ status=ok$/);
    expect(lines[5]).toMatch(/phone=\(\d{3}\)\d{3}-\d{4} owner=\S+@\S+$/);
  }, TIMEOUT);

  it('keeps the international claims grid and national ID shapes', () => {
    const { rows } = outputs.get('insurance-claims.csv');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual([
      'Claim ID', 'Member Name', 'Date of Birth', 'NI Number', 'NHS Number',
      'CPF', 'Aadhaar', 'SIN', 'TFN', 'Phone', 'Address', 'Postcode', 'Payout', 'Notes',
    ]);
    for (const row of rows.slice(1)) expect(row).toHaveLength(14);

    // Every scheme keeps its own punctuation and width.
    expect(rows[1][3]).toMatch(/^[A-Z]{2} \d{2} \d{2} \d{2} [A-D]$/);
    expect(rows[1][4]).toMatch(/^\d{3} \d{3} \d{4}$/);
    expect(rows[2][5]).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect(rows[3][6]).toMatch(/^\d{4} \d{4} \d{4}$/);
    expect(rows[4][7]).toMatch(/^\d{3}-\d{3}-\d{3}$/);
    expect(rows[4][8]).toMatch(/^\d{3} \d{3} \d{3}$/);
    expect(rows[1][9]).toMatch(/^\+44 \d{2} \d{4} \d{4}$/);
    expect(rows[2][9]).toMatch(/^\+55 \d{2} \d{5}-\d{4}$/);
    expect(rows[3][9]).toMatch(/^\+91 \d{5} \d{5}$/);
    // Postcodes keep their country's pattern, not a US ZIP.
    expect(rows[1][11]).toMatch(/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/);
    expect(rows[2][11]).toMatch(/^\d{5}-\d{3}$/);
    expect(rows[3][11]).toMatch(/^\d{6}$/);
    expect(rows[4][11]).toMatch(/^[A-Z]\d[A-Z] \d[A-Z]\d$/);
    expect(rows[1][13]).toMatch(/^Callback on \d{4} \d{3} \d{4}\.$/);
  }, TIMEOUT);

  it('keeps the HTML report markup and table structure', () => {
    const { text } = outputs.get('hr-records.html');
    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(text).toContain('<title>Employee Records — Q1</title>');
    expect(text).toContain('<table class="employees">');
    expect(text).toContain('<table class="kv">');
    expect(text).toContain('<th>Full Name</th>');
    expect(text).toMatch(/<td>EMP-\d{4}<\/td>/);
    // 1 thead row + 3 employee rows + 3 label/value rows.
    expect((text.match(/<tr>/g) || [])).toHaveLength(7);
    expect((text.match(/<td>/g) || [])).toHaveLength(27);
    expect(text).toMatch(/<a href="mailto:[^"@]+@[^"]+">[^<@]+@[^<]+<\/a>/);
    expect(text).not.toContain('mailto:hr@northwind.example');
    for (const label of ['Name', 'Phone', 'Email']) expect(text).toContain(`<th>${label}</th>`);
    expect(text).toMatch(/<p>Questions: <a href="mailto:[^"]+">[^<]+<\/a> or \(\d{3}\) \d{3}-\d{4}\.<\/p>/);
  }, TIMEOUT);

  it('keeps the env file parseable and every secret recognisable', () => {
    const { text } = outputs.get('app-config.env');
    const value = (key) => {
      const match = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
      return match ? match[1] : '';
    };
    expect(text).toContain('# Production configuration');
    expect(value('APP_ENV')).toBe('production');
    // Connection strings keep scheme, port and database name.
    expect(value('DATABASE_URL')).toMatch(/^postgres:\/\/[^:]+:[^@]+@[^/\s]+:5432\/orders$/);
    expect(value('REDIS_URL')).toMatch(/^redis:\/\/[^:]+:[^@]+@[^/\s]+:6379\/0$/);
    // Key prefixes survive, so the reader still knows what the key was.
    expect(value('STRIPE_SECRET_KEY')).toMatch(/^sk_live_[A-Za-z0-9]{16,}$/);
    expect(value('GOOGLE_MAPS_API_KEY')).toMatch(/^AIza[0-9A-Za-z_-]{35}$/);
    expect(value('SENDGRID_API_KEY')).toMatch(/^SG\.[\w-]{16,}\.[\w-]{16,}$/);
    expect(value('TWILIO_API_KEY')).toMatch(/^SK[0-9a-f]{32}$/);
    expect(value('NPM_TOKEN')).toMatch(/^npm_[A-Za-z0-9]{36}$/);
    expect(value('SLACK_WEBHOOK')).toMatch(/^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Z0-9]+$/);
    expect(value('AWS_ACCESS_KEY_ID')).toMatch(/^AKIA[A-Z0-9]{16}$/);
    expect(value('ADMIN_EMAIL')).toMatch(/^[^@\s]+@[^@\s]+$/);
    expect(value('SUPPORT_PHONE')).toMatch(/^\+44 \d{2} \d{4} \d{4}$/);
    expect(value('OFFICE_IP')).toMatch(/^[0-9a-f:]+$/);
    expect(value('PRINTER_MAC')).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    // Header attributes are structure; only the session value changes.
    expect(value('SESSION_COOKIE')).toMatch(/^session=[0-9a-f]{32}; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(text).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(text).toContain('-----END OPENSSH PRIVATE KEY-----');
  }, TIMEOUT);

  it('keeps the YAML profile nested and its values typed', () => {
    const { text } = outputs.get('customer-profile.yaml');
    expect(text).toContain('# Customer profile — internal use only');
    expect(text).toMatch(/^customer:$/m);
    expect(text).toMatch(/^  id: [A-Z]{3}-\d{5}$/m);
    expect(text).toMatch(/^  full_name: .+$/m);
    expect(text).toMatch(/^  phone: "\+\d{2} \d{2} \d{2} \d{2} \d{2}"$/m);
    expect(text).toMatch(/^  date_of_birth: \d{4}-\d{2}-\d{2}$/m);
    expect(text).toMatch(/^  national_id: "[A-Z]{2} \d{2} \d{2} \d{2} [A-D]"$/m);
    expect(text).toMatch(/^  address:$/m);
    expect(text).toMatch(/^    line1: "[^"]+"$/m);
    expect(text).toMatch(/^    postal_code: "\d{4}"$/m);
    expect(text).toMatch(/^  vehicle_vin: [A-HJ-NPR-Z0-9]{17}$/m);
    expect(text).toMatch(/^  crypto_wallet: "0x[a-f0-9]{40}"$/m);
    expect(text).toMatch(/^  last_login:$/m);
    expect(text).toMatch(/^    ip: \d+\.\d+\.\d+\.\d+$/m);
    expect(text).toMatch(/^    at: 2024-02-11T08:14:00Z$/m);
    expect(text).toMatch(/^  coordinates: "-?\d+\.\d+, -?\d+\.\d+"$/m);
  }, TIMEOUT);

  it('decodes, scrubs and re-encodes an encoded email', async () => {
    const { text } = outputs.get('mail-encoded.eml');
    const lines = text.split(/\r?\n/);
    expect(text).toContain('boundary="----=_Part_Encoded_1"');
    expect(lines.filter((line) => line === 'Content-Transfer-Encoding: base64')).toHaveLength(2);
    expect(lines.filter((line) => line === 'Content-Transfer-Encoding: quoted-printable')).toHaveLength(1);
    // Nothing from the encoded words or the QP body survives in raw form.
    expect(text).not.toContain('Wm/DqyBMYXVyZW50');
    expect(text).not.toContain('Zo=C3=AB');
    expect(text).not.toMatch(/Zoë/);

    const pieces = text.split(/\r\n------=_Part_Encoded_1/);
    expect(pieces).toHaveLength(5);
    const plain = decodeQuotedPrintable(mimePartBody(pieces[1]));
    expect(plain).toMatch(/Call \d{2,4} \d{3,4} \d{4}/);
    expect(plain).toMatch(/Date of birth on file: \d{4}-\d{2}-\d{2}\./);
    expect(plain).toMatch(/\r\nThanks,\r\n[A-Za-z' -]+\r\n/);
    expect(plain).not.toContain('1982-05-17');

    const html = Buffer.from(mimePartBody(pieces[2]).replace(/\s+/g, ''), 'base64').toString('utf8');
    expect(html).toMatch(/^<html><body>/);
    expect(html).toMatch(/<p>[^<]+ — \(?\d{2,4}\)?[\d ]+<\/p>/);

    // Attachment bytes are untouched; only the filename is scrubbed.
    const original = await fs.readFile(path.join(FIXTURES, 'mail-encoded.eml'), 'utf8');
    const originalAttachment = mimePartBody(original.split(/\r\n------=_Part_Encoded_1/)[3]).trim();
    expect(mimePartBody(pieces[3]).trim()).toBe(originalAttachment);
    expect(pieces[3]).toMatch(/filename="[^"]+ - statement\.pdf"/);
    expect(pieces[3]).not.toContain('Zoë Laurent - statement.pdf');
  }, TIMEOUT);

  it('keeps the XML export well-formed and element/attribute names intact', () => {
    const { text } = outputs.get('crm-export.xml');
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(text).toContain('<crm:CustomerExport xmlns:crm="urn:example:crm" exportedAt="2024-02-12T09:00:00Z">');
    expect((text.match(/<crm:Customer id="CUS-\d{5}">/g) || [])).toHaveLength(3);
    expect(text).toMatch(/<crm:Phone>\+44 \d{2} \d{4} \d{4}<\/crm:Phone>/);
    expect(text).toMatch(/<crm:DateOfBirth>\d{4}-\d{2}-\d{2}<\/crm:DateOfBirth>/);
    expect(text).toMatch(/<crm:Balance currency="GBP">\d+\.\d{2}<\/crm:Balance>/);
    expect(text).toMatch(/<crm:AccountNumber>\d{12}<\/crm:AccountNumber>/);
    // Attribute values are scrubbed, the attribute names and country stay.
    expect(text).toMatch(/<crm:Contact email="[^"@]+@[^"]+" phone="\+91 \d{5} \d{5}"\/>/);
    expect(text).toMatch(/<crm:Address line1="[^"]+" city="[^"]+" postcode="[A-Z]\d{2} [A-Z0-9]{4}" country="IE"\/>/);
    expect(text).toContain('country="BR"');
    // No unescaped ampersand crept in, so the document still parses.
    expect(text).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#)/);
  }, TIMEOUT);

  it('keeps the SQL dump executable: quoting, tuple count and money columns', () => {
    const { text } = outputs.get('customers-dump.sql');
    expect(text).toContain('/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;');
    expect(text).toContain('CREATE TABLE `customers` (');
    expect(text).toContain('LOCK TABLES `customers` WRITE;');
    expect(text).toContain('UNLOCK TABLES;');

    const insert = text.slice(text.indexOf('INSERT INTO'));
    // Three rows, still one INSERT statement, still 10 columns each.
    expect((insert.match(/\(\d+,'/g) || [])).toHaveLength(3);
    expect(insert).toMatch(/VALUES \(1,'/);
    expect(insert).toMatch(/,\d+\.\d{2}\),\(/);
    expect(insert).toMatch(/,\d+\.\d{2}\);/);
    // Every quote is paired, and the name with an apostrophe was re-escaped.
    expect(((insert.match(/'/g) || []).length) % 2).toBe(0);
    expect(insert).not.toContain("O''Brien");
    expect(insert).toMatch(/,'\d{3}-\d{2}-\d{4}'/);
  }, TIMEOUT);

  it('keeps the slide deck readable: title, subtitle, table and notes', () => {
    const { text, parts } = outputs.get('board-deck.pptx');
    expect(parts).toBe(2);
    expect(text).toContain('Q1 hiring review — confidential');
    expect(text).toContain('Full Name');
    expect(text).toContain('Department');
    expect(text).toContain('Finance');
    expect(text).toContain('Engineering');
    // 2 title/subtitle runs + 3 rows x 4 cells + 1 speaker-note run.
    expect(text.split('\n')).toHaveLength(15);
  }, TIMEOUT);

  it('keeps the passport MRZ two valid 44-character lines', () => {
    const { text } = outputs.get('passport-mrz.txt');
    const lines = text.split(/\r?\n/).filter((line) => /^[A-Z0-9<]{30,44}$/.test(line));
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.length)).toEqual([44, 44]);
    const parsed = parseMrz(lines.join('\n'));
    expect(parsed, 'the sanitized MRZ must still pass every check digit').toBeTruthy();
    expect(parsed.passport).not.toBe('L898902C3');
    // The surrounding dossier text keeps its labels and prose.
    expect(text).toContain('Applicant: ');
    expect(text).toContain('Machine-readable zone:');
    expect(text).toContain('Verified against the original document on 2024-02-12.');
  }, TIMEOUT);

  it('keeps LDIF attribute lines parseable', () => {
    const { text } = outputs.get('directory-export.ldif');
    expect((text.match(/^dn: cn=.+,ou=People,dc=example,dc=com$/gm) || [])).toHaveLength(2);
    for (const attribute of [
      'cn', 'sn', 'givenName', 'mail', 'telephoneNumber', 'uid', 'employeeNumber',
      'homePostalAddress', 'userPassword',
    ]) {
      expect(text, `missing ${attribute}`).toMatch(new RegExp(`^${attribute}: `, 'm'));
    }
    // Passwords keep their hash prefix and base64 shape.
    expect((text.match(/userPassword: \{SSHA\}[A-Za-z0-9+/=]+/g) || [])).toHaveLength(2);
    // One blank separator between records plus the trailing newline.
    expect(text.split(/\r?\n/).filter((line) => line.trim() === '')).toHaveLength(2);
  }, TIMEOUT);

  it('keeps one fake identity across every document that mentions it', () => {
    for (const [original, type] of [
      ['Camille Dubois', 'name'],
      ['nadia.okafor@riverside.example', 'email'],
      ['USR-88213', 'recordId'],
    ]) {
      const entry = entries.find((item) => item.type === type && item.original === original);
      expect(entry, `missing ${type} entry for ${original}`).toBeTruthy();
      const files = [...outputs.values()].filter((output) => output.text.includes(entry.fakeValue));
      expect(files.length, `${original} -> ${entry.fakeValue} should appear in several files`).toBeGreaterThanOrEqual(2);
    }
  }, TIMEOUT);
});
