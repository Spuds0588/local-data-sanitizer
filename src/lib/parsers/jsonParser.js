// JSON: parse -> recurse through keys/values -> replace -> re-serialize.

import { applyEntriesToText, sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue } from '../columns.js';

// Whole-dollar figures (4250, -1200) carry no currency mark or decimal, so the
// text detectors deliberately ignore bare integers. A key like "balance" or
// "amount" is the missing context: under those keys the number is money.
const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/;

function collectStrings(value, out, moneyNumbers, typedValues, key = '') {
  if (typeof value === 'string') {
    if (!value) return;
    out.push(value);
    const type = classifyHeader(key);
    const trimmed = value.trim();
    // "balance": "4250" - same leak, but the original really is a string.
    if (type === 'amount' && BARE_NUMBER.test(trimmed)) {
      moneyNumbers.push({ original: trimmed, key, numeric: false });
    } else if (type) {
      const item = extractTypedValue(type, trimmed);
      if (item) typedValues.push({ original: item.original, type: item.type, key, numeric: false });
    }
    return;
  }
  // Numeric leaves are scanned as their text form so a financial JSON export
  // ("balance": 1234.56) can be jiggled too.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return;
    out.push(String(value));
    const type = classifyHeader(key);
    if (type === 'amount') {
      moneyNumbers.push({ original: String(value), key, numeric: true });
    } else if (type) {
      const item = extractTypedValue(type, String(value));
      if (item) typedValues.push({ original: String(value), type: item.type, key, numeric: true });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, out, moneyNumbers, typedValues, key));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k) out.push(k);
      collectStrings(v, out, moneyNumbers, typedValues, k);
    }
  }
}

/** Amount entries keyed by their original text, for numeric JSON leaves. */
function amountMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (entry && entry.enabled !== false && entry.original && entry.type === 'amount') {
      map.set(String(entry.original), entry.fakeValue);
    }
  }
  return map;
}

/** Context-typed numeric leaves (numeric account numbers, ZIPs, phone numbers). */
function typedNumberMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (entry && entry.enabled !== false && entry.original && entry.type !== 'amount') {
      map.set(String(entry.original), { fakeValue: entry.fakeValue, type: entry.type });
    }
  }
  return map;
}

/** Stay a JSON number when the replacement still parses as one. */
function typedValue(fake) {
  const numeric = Number(fake);
  return Number.isFinite(numeric) ? numeric : fake;
}

// Object keys are schema, not prose: a derived name token like "City" must
// never rename `address.city`. Only high-signal values replace a key.
const KEY_TYPES = new Set([
  'email', 'phone', 'ssn', 'creditCard', 'creditCardPartial', 'account',
  'routing', 'iban', 'taxId', 'address', 'recordId', 'password', 'apiKey',
]);

function transformKey(key, entries) {
  return applyEntriesToText(
    key,
    entries.filter((entry) => KEY_TYPES.has(entry.type)),
  );
}

function transform(value, entries, amounts, typedNumbers, key = '') {
  if (typeof value === 'string') return applyEntriesToText(value, entries);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const keyType = classifyHeader(key);
    const fake = amounts.get(String(value));
    if (fake !== undefined && keyType === 'amount') return typedValue(fake);
    const typed = typedNumbers.get(String(value));
    if (typed && (typed.type === keyType || (typed.type === 'creditCard' && keyType === 'card'))) {
      return typedValue(typed.fakeValue);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => transform(v, entries, amounts, typedNumbers, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[transformKey(k, entries)] = transform(v, entries, amounts, typedNumbers, k);
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
  const typedValues = [];
  collectStrings(data, segments, moneyNumbers, typedValues);
  console.log(
    `[JSON Parser] ${file.name}: collected ${segments.length} string(s), ` +
      `${moneyNumbers.length} money-keyed number(s), ${typedValues.length} typed value(s).`,
  );
  return { segments, moneyNumbers, typedValues };
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
  const text = JSON.stringify(transform(data, textEntries, amountMap(entries), typedNumberMap(entries)), null, 2);
  console.log(`[JSON Parser] ${file.name}: wrote ${text.length} sanitized chars.`);
  return { blob: new Blob([text], { type: 'application/json' }), name: sanitizedName(file.name, 'json') };
}
