// Detection + execution engine. Owns the referential-integrity dictionary.

import { detectInText } from './rules.js';
import { generateFake } from './fake.js';
import { getParser } from './parsers/index.js';
import { escapeRegExp } from './text.js';

const CASELESS_TYPES = new Set(['custom', 'email', 'name', 'password', 'organization']);

/** Case-insensitive types share one dictionary entry regardless of casing. */
export function canonicalKey(type, value) {
  return CASELESS_TYPES.has(type) ? String(value).toLowerCase() : value;
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
/** Remove a whole phrase so its own words are not counted as standalone hits. */
function stripPhrase(text, value) {
  const re = new RegExp(
    `(?<![A-Za-z0-9])(?:${escapeRegExp(value)})(?![A-Za-z0-9])`,
    'gi',
  );
  return text.replace(re, (match) => ' '.repeat(match.length));
}

const EXPANDABLE_TYPES = new Set(['custom', 'name']);

// Never turn a generic corporate suffix or filler word into a standalone
// replacement: "LLC" in one row must not become a person's surname.
const GENERIC_NAME_WORDS = new Set([
  'llc', 'inc', 'corp', 'ltd', 'co', 'plc', 'gmbh', 'the', 'and', 'of', '&',
  'group', 'team', 'company', 'corporation', 'incorporated', 'limited',
]);

export function expandEntries(entries, texts = []) {
  const out = [...entries];
  const byKey = new Map(out.map((e) => [`${e.type}:${canonicalKey(e.type, e.original)}`, e]));
  // Entries whose fake value is already tied to a full name (either derived
  // from one, or adopted by one) must not be rewritten by a later parent.
  const locked = new Set();

  const add = (original, fakeValue, parent, type, searchTexts) => {
    const key = canonicalKey(type, original);
    if (original.length < 3) return;
    if (type === 'name' && GENERIC_NAME_WORDS.has(original.toLowerCase())) return;
    if (original.toLowerCase() === String(fakeValue).toLowerCase()) return;
    const id = `${type}:${key}`;

    const existing = byKey.get(id);
    if (existing) {
      // A split "First Name"/"Last Name" column produces a standalone "Aisha"
      // entry; it must agree with the "Aisha" inside "Aisha Rahman" typed from
      // another file, or the same person gets two different first names.
      if (!locked.has(id) && String(existing.fakeValue).toLowerCase() !== String(fakeValue).toLowerCase()) {
        existing.fakeValue = fakeValue;
        locked.add(id);
      }
      return;
    }

    // "Northwest Community Bank" says nothing about a standalone "Bank": the
    // phrase itself contains that word, so strip it before counting tokens.
    const { count, context } = occurrenceStats(searchTexts, original);
    if (count === 0) return;
    locked.add(id);
    const entry = {
      id,
      key,
      type,
      original,
      fakeValue,
      count,
      context: context || parent.context,
      enabled: true,
      derivedFrom: parent.id,
    };
    byKey.set(id, entry);
    out.push(entry);
  };

  for (const entry of entries) {
    if (!EXPANDABLE_TYPES.has(entry.type)) continue;
    const originals = String(entry.original).trim().split(/\s+/);
    if (originals.length < 2) continue;
    const fakes = String(entry.fakeValue).trim().split(/\s+/);
    if (fakes.length !== originals.length) continue;
    const searchTexts = texts.map((text) => stripPhrase(text, entry.original));
    originals.forEach((original, i) => {
      add(original, fakes[i], entry, entry.type, searchTexts);
      // "Doe, Jane" keeps its comma in the fake; also map the bare token so
      // "Doe called" elsewhere still resolves to the same surname.
      const cleaned = original.replace(/[,;:]+$/, '');
      if (cleaned !== original && cleaned.length >= 3) {
        add(cleaned, String(fakes[i]).replace(/[,;:]+$/, ''), entry, entry.type, searchTexts);
      }
    });
    add(originals.join(''), fakes.join(''), entry, entry.type, searchTexts);
  }

  return out;
}

/**
 * A masked SSN / "SSN ending in 2244" must not keep the real last four when
 * the full number is also in the session: link it to the full number's fake.
 */
export function linkSsnFragments(entries, used = new Set()) {
  const ssns = new Map();
  for (const entry of entries) {
    if (entry.type !== 'ssn') continue;
    const original = lastFour(entry.original);
    const fake = lastFour(entry.fakeValue);
    if (original && fake && !ssns.has(original)) ssns.set(original, fake);
  }
  for (const entry of entries) {
    if (entry.type !== 'ssnPartial') continue;
    const fake = ssns.get(lastFour(entry.original)) || generateFake('ssnPartial', entry.original, used);
    entry.fakeValue = /\d{4}(?!.*\d)/.test(entry.original)
      ? entry.original.replace(/\d{4}(?!.*\d)/, fake)
      : fake;
  }
  return entries;
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
 * Whole-dollar figures under a money key ("balance": 4250) have no currency
 * mark or decimal for the text detectors to key on. Parsers that know the key
 * report them separately; merge them into the same dictionary.
 */
function addMoneyNumbers(found, moneyNumbers) {
  const byOriginal = new Map(found.filter((e) => e.type === 'amount').map((e) => [e.original, e]));
  const fromNumbers = new Set();
  for (const item of moneyNumbers) {
    const original = String(item.original);
    if (!original) continue;
    const existing = byOriginal.get(original);
    if (existing) {
      // A formatted amount (1234.56) was already counted by the text scan; a
      // repeated bare number (two 4250 balances) was not.
      if (fromNumbers.has(original)) existing.count += 1;
      // A string occurrence can be replaced anywhere; a numeric one cannot.
      if (!item.numeric) delete existing.numericOnly;
      continue;
    }
    fromNumbers.add(original);
    const entry = {
      id: `amount:${original}`,
      key: original,
      type: 'amount',
      original,
      count: 1,
      context: `${item.key}: ${original}`,
    };
    if (item.numeric) entry.numericOnly = true;
    byOriginal.set(original, entry);
    found.push(entry);
  }
}

/**
 * Values the parser typed from column headers / object keys (a bare account
 * number, a customer name, a date of birth). They join the same dictionary as
 * regex hits so every occurrence is replaced consistently.
 */
function addTypedValues(found, typedValues) {
  const byKey = new Map(found.map((e) => [`${e.type}:${canonicalKey(e.type, e.original)}`, e]));
  const byOriginal = new Map(found.map((e) => [e.original, e]));
  for (const item of typedValues) {
    const original = String(item.original ?? '');
    if (!original) continue;
    const key = `${item.type}:${canonicalKey(item.type, original)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (!item.numeric) delete existing.numericOnly;
      continue;
    }
    // The text scan already found this exact value under another type. One
    // entry is enough; replacing it once removes every occurrence.
    if (byOriginal.has(original)) continue;
    const entry = {
      id: key,
      key: canonicalKey(item.type, original),
      type: item.type,
      original,
      count: 1,
      context: `${item.key || 'column'}: ${original}`,
    };
    if (item.numeric) entry.numericOnly = true;
    byKey.set(key, entry);
    byOriginal.set(original, entry);
    found.push(entry);
  }
}

/**
 * Scan every file and build the review entries (original -> proposed fake).
 * @param {File[]} files
 * @param {import('./rules.js').DEFAULT_CONFIG} config
 * @param {(msg:string)=>void} log
 */
export async function analyzeFiles(files, config, log = () => {}) {
  const texts = [];
  const moneyNumbers = [];
  const typedValues = [];
  for (const file of files) {
    const parser = getParser(file);
    const detected = parser.detectWithMeta
      ? await parser.detectWithMeta(file, config, log)
      : { segments: await parser.detect(file, config, log) };
    const segments = Array.isArray(detected) ? detected : detected.segments || [];
    log(`Scanned "${file.name}" (${segments.length} text segment(s)).`);
    texts.push(...segments);
    if (!Array.isArray(detected)) {
      if (Array.isArray(detected.moneyNumbers)) moneyNumbers.push(...detected.moneyNumbers);
      if (Array.isArray(detected.typedValues)) typedValues.push(...detected.typedValues);
    }
  }

  const found = scanTexts(texts, config);
  addMoneyNumbers(found, moneyNumbers);
  addTypedValues(found, typedValues);
  // A fake must never collide with any original value either: publishing
  // another file's real balance (or name) as a "replacement" would defeat the
  // sanitizer even though the bytes changed.
  const used = new Set(found.map((item) => String(item.original)));
  // A fake must not accidentally reuse a real name word from any file: a
  // "Marcus Webb" replacement of "Marcus Hart" would still publish "Marcus".
  const forbidden = new Set();
  for (const item of found) {
    for (const token of String(item.original).toLowerCase().split(/\s+/)) {
      if (token.length >= 3) forbidden.add(token);
    }
  }
  let entries = found.map((f) => ({
    ...f,
    fakeValue: generateFake(f.type, f.original, used, forbidden),
    enabled: true,
  }));
  entries = expandEntries(entries, texts);
  entries = linkCardFragments(entries, used);
  entries = linkSsnFragments(entries, used);

  // Never dump the dictionary itself to the console: it holds the originals.
  log(`Detection complete: ${entries.length} unique item(s) across ${files.length} file(s).`);
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
