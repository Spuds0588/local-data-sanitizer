// JSON: parse -> recurse through keys/values -> replace -> re-serialize.

import { applyEntriesToText, sanitizedName } from '../text.js';

function collectStrings(value, out) {
  if (typeof value === 'string') {
    if (value) out.push(value);
    return;
  }
  // Numeric leaves are scanned as their text form so a financial JSON export
  // ("balance": 1234.56) can be jiggled too.
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k) out.push(k);
      collectStrings(v, out);
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

export async function detect(file) {
  const data = await readJson(file);
  const out = [];
  collectStrings(data, out);
  console.log(`[JSON Parser] ${file.name}: collected ${out.length} string(s) for scanning.`);
  return out;
}

export async function sanitize(file, entries) {
  const data = await readJson(file);
  const text = JSON.stringify(transform(data, entries, amountMap(entries)), null, 2);
  console.log(`[JSON Parser] ${file.name}: wrote ${text.length} sanitized chars.`);
  return { blob: new Blob([text], { type: 'application/json' }), name: sanitizedName(file.name, 'json') };
}
