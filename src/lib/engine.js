// Detection + execution engine. Owns the referential-integrity dictionary.

import { detectInText } from './rules.js';
import { generateFake } from './fake.js';
import { getParser } from './parsers/index.js';
import { escapeRegExp } from './text.js';

/** Case-insensitive types share one dictionary entry regardless of casing. */
export function canonicalKey(type, value) {
  return type === 'custom' || type === 'email' ? value.toLowerCase() : value;
}

function makeContext(text, match, radius = 45) {
  const pre = text.slice(Math.max(0, match.start - radius), match.start);
  const mid = text.slice(match.start, match.end);
  const post = text.slice(match.end, Math.min(text.length, match.end + radius));
  const prefix = match.start > radius ? '…' : '';
  const suffix = match.end + radius < text.length ? '…' : '';
  return `${prefix}${pre}[${mid}]${post}${suffix}`.replace(/\s+/g, ' ').trim();
}

function lastFour(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.slice(-4);
}

/** Occurrence count + first context snippet for a literal value. */
function occurrenceStats(texts, value) {
  const re = new RegExp(escapeRegExp(value), 'gi');
  let count = 0;
  let context = '';
  for (const text of texts) {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (count === 0) context = makeContext(text, { start: m.index, end: m.index + m[0].length });
      count += 1;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return { count, context };
}

/**
 * "John Smith" must not leak through as a bare "Smith" elsewhere in the file.
 * Every multi-word custom keyword is expanded into its individual tokens (and
 * the unspaced form "JohnSmith"), each mapped to the matching token of the
 * parent's fake so the whole document stays internally consistent.
 */
export function expandEntries(entries, texts = []) {
  const out = [...entries];
  const taken = new Set(entries.map((e) => `${e.type}:${canonicalKey(e.type, e.original)}`));

  const add = (original, fakeValue, parent) => {
    const key = canonicalKey('custom', original);
    if (original.length < 3 || taken.has(`custom:${key}`)) return;
    if (original.toLowerCase() === String(fakeValue).toLowerCase()) return;
    const { count, context } = occurrenceStats(texts, original);
    if (count === 0) return;
    taken.add(`custom:${key}`);
    out.push({
      id: `custom:${key}`,
      key,
      type: 'custom',
      original,
      fakeValue,
      count,
      context: context || parent.context,
      enabled: true,
      derivedFrom: parent.id,
    });
  };

  for (const entry of entries) {
    if (entry.type !== 'custom') continue;
    const originals = String(entry.original).trim().split(/\s+/);
    if (originals.length < 2) continue;
    const fakes = String(entry.fakeValue).trim().split(/\s+/);
    if (fakes.length !== originals.length) continue;
    originals.forEach((original, i) => add(original, fakes[i], entry));
    add(originals.join(''), fakes.join(''), entry);
  }

  return out;
}

/**
 * "ending in 1234" (or a masked card) should stay consistent with the full
 * card number when the same document contains one: same last four, new digits.
 */
export function linkCardFragments(entries, used = new Set()) {
  const cards = new Map();
  for (const entry of entries) {
    if (entry.type !== 'creditCard') continue;
    const original = lastFour(entry.original);
    const fake = lastFour(entry.fakeValue);
    if (original && fake && !cards.has(original)) cards.set(original, fake);
  }
  for (const entry of entries) {
    if (entry.type !== 'creditCardPartial') continue;
    const fake = cards.get(lastFour(entry.original)) || generateFake('creditCardPartial', entry.original, used);
    entry.fakeValue = entry.original.replace(/\d{4}$/, fake);
  }
  return entries;
}

/**
 * Aggregate unique matches across many text segments.
 * Referential integrity: identical originals collapse into a single record.
 */
export function scanTexts(texts, config) {
  const map = new Map();
  for (const text of texts) {
    if (typeof text !== 'string' || !text) continue;
    for (const match of detectInText(text, config)) {
      const key = canonicalKey(match.type, match.value);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          id: `${match.type}:${key}`,
          key,
          type: match.type,
          original: match.value,
          count: 1,
          context: makeContext(text, match),
        });
      }
    }
  }
  return [...map.values()];
}

/**
 * Scan every file and build the review entries (original -> proposed fake).
 * @param {File[]} files
 * @param {import('./rules.js').DEFAULT_CONFIG} config
 * @param {(msg:string)=>void} log
 */
export async function analyzeFiles(files, config, log = () => {}) {
  const texts = [];
  for (const file of files) {
    const parser = getParser(file);
    const segments = await parser.detect(file, config, log);
    log(`Scanned "${file.name}" (${segments.length} text segment(s)).`);
    texts.push(...segments);
  }

  const found = scanTexts(texts, config);
  const used = new Set();
  let entries = found.map((f) => ({
    ...f,
    fakeValue: generateFake(f.type, f.original, used),
    enabled: true,
  }));
  entries = expandEntries(entries, texts);
  entries = linkCardFragments(entries, used);

  log(`Detection complete: ${entries.length} unique item(s) across ${files.length} file(s).`);
  console.log('[Engine] Entries:', entries);
  return entries;
}

/** Apply the approved dictionary and produce a downloadable blob per file. */
export async function sanitizeFiles(files, entries, log = () => {}) {
  const results = [];
  for (const file of files) {
    const parser = getParser(file);
    const out = await parser.sanitize(file, entries, log);
    log(`Sanitized "${file.name}" -> "${out.name}".`);
    results.push(out);
  }
  return results;
}

/** Trigger a browser download for a generated blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  console.log(`[Download] ${filename} (${blob.size} bytes).`);
}
