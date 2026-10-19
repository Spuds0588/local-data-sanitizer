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

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const TIMEOUT = 60_000;

let manifest;
let entries;
const outputs = new Map();

function textNodes(xml) {
  const out = [];
  const re = />([^<]*)</g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    if (match[1] && match[1].trim()) out.push(match[1]);
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
  if (/\.xlsx$/i.test(name)) {
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true, cellText: true });
    return { name, kind: 'sheet', text: sheetText(wb), wb };
  }
  if (/\.docx$/i.test(name)) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const entry = zip.file('word/document.xml');
    expect(entry, `${name} must still be a valid docx`).toBeTruthy();
    const xml = await entry.async('string');
    return { name, kind: 'docx', text: textNodes(xml).join('\n'), xml };
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
      'apiKey', 'recordId',
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

    for (const entry of entries.filter((item) => item.type === 'phone')) {
      expect(entry.fakeValue).toMatch(/^\([2-9]\d{2}\) [2-9]\d{2}-\d{4}$/);
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
});
