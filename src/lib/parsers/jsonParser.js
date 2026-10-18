// JSON: parse -> recurse through keys/values -> replace -> re-serialize.

import { applyEntriesToText, sanitizedName } from '../text.js';

function collectStrings(value, out) {
  if (typeof value === 'string') {
    if (value) out.push(value);
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

function transform(value, entries) {
  if (typeof value === 'string') return applyEntriesToText(value, entries);
  if (Array.isArray(value)) return value.map((v) => transform(v, entries));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[applyEntriesToText(k, entries)] = transform(v, entries);
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
  const text = JSON.stringify(transform(data, entries), null, 2);
  console.log(`[JSON Parser] ${file.name}: wrote ${text.length} sanitized chars.`);
  return { blob: new Blob([text], { type: 'application/json' }), name: sanitizedName(file.name, 'json') };
}
