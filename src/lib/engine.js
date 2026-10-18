// Detection + execution engine. Owns the referential-integrity dictionary.

import { detectInText } from './rules.js';
import { generateFake } from './fake.js';
import { getParser } from './parsers/index.js';

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
  const entries = found.map((f) => ({
    ...f,
    fakeValue: generateFake(f.type, f.original, used),
    enabled: true,
  }));

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
