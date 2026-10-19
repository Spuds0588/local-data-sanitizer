// JSON: parse -> recurse through keys/values -> replace -> re-serialize.

import { applyEntriesToText, sanitizedName } from '../text.js';

// Whole-dollar figures (4250, -1200) carry no currency mark or decimal, so the
// text detectors deliberately ignore bare integers. A key like "balance" or
// "amount" is the missing context: under those keys the number is money.
const MONEY_KEY = /(amount|balance|subtotal|total|price|cost|debit|credit|salary|wage|fee|tax|payment|deposit|withdrawal|net|gross|due|paid|refund|sum)/i;
const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/;

function collectStrings(value, out, moneyNumbers, key = '') {
  if (typeof value === 'string') {
    if (!value) return;
    out.push(value);
    // "balance": "4250" - same leak, but the original really is a string.
    const trimmed = value.trim();
    if (MONEY_KEY.test(key) && BARE_NUMBER.test(trimmed)) {
      moneyNumbers.push({ original: trimmed, key, numeric: false });
    }
    return;
  }
  // Numeric leaves are scanned as their text form so a financial JSON export
  // ("balance": 1234.56) can be jiggled too.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return;
    out.push(String(value));
    if (MONEY_KEY.test(key)) moneyNumbers.push({ original: String(value), key, numeric: true });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, out, moneyNumbers, key));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k) out.push(k);
      collectStrings(v, out, moneyNumbers, k);
    }
  }
}

/** Amount entries keyed by their original text, for numeric JSON leaves. */
function amountMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (entry && entry.type === 'amount' && entry.enabled !== false && entry.original) {
      map.set(String(entry.original), entry.fakeValue);
    }
  }
  return map;
}

function transform(value, entries, amounts) {
  if (typeof value === 'string') return applyEntriesToText(value, entries);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const fake = amounts.get(String(value));
    if (fake === undefined) return value;
    // Stay a JSON number when the replacement still parses as one, so the
    // document keeps its schema; fall back to the raw override otherwise.
    const numeric = Number(fake);
    return Number.isFinite(numeric) ? numeric : fake;
  }
  if (Array.isArray(value)) return value.map((v) => transform(v, entries, amounts));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[applyEntriesToText(k, entries)] = transform(v, entries, amounts);
    }
    return out;
  }
  return value;
}

async function readJson(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in "${file.name}": ${err.message}`);
  }
}

export async function detectWithMeta(file) {
  const data = await readJson(file);
  const segments = [];
  const moneyNumbers = [];
  collectStrings(data, segments, moneyNumbers);
  console.log(
    `[JSON Parser] ${file.name}: collected ${segments.length} string(s) and ${moneyNumbers.length} money-keyed number(s).`,
  );
  return { segments, moneyNumbers };
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

export async function sanitize(file, entries) {
  const data = await readJson(file);
  // Bare-number entries are only safe to apply to numeric leaves; replacing
  // "4250" inside an unrelated string could corrupt an ID.
  const textEntries = entries.filter((entry) => entry && !entry.numericOnly);
  const text = JSON.stringify(transform(data, textEntries, amountMap(entries)), null, 2);
  console.log(`[JSON Parser] ${file.name}: wrote ${text.length} sanitized chars.`);
  return { blob: new Blob([text], { type: 'application/json' }), name: sanitizedName(file.name, 'json') };
}
