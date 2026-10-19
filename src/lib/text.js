// Shared text helpers used by both the detection engine and every parser.

export function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escape a replacement value so it is safe inside an XML text node. */
export function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Replace every occurrence of a string with another, ignoring replacer $-tokens.
 * @param {string} text
 * @param {string} search
 * @param {string} replacement
 * @param {boolean} caseInsensitive
 */
export function replaceAll(text, search, replacement, caseInsensitive = false) {
  if (!search) return text;
  const re = new RegExp(escapeRegExp(search), caseInsensitive ? 'gi' : 'g');
  return text.replace(re, () => replacement);
}

/**
 * Apply the approved replacement dictionary entries to a single string.
 * Matching is case-insensitive so "John Doe" and "john doe" resolve to the
 * same fake value (referential integrity); digits are unaffected by casing.
 *
 * Everything runs in one pass with a single alternation. Doing it entry by
 * entry would let a later, shorter original match inside an already-written
 * fake value and corrupt it — e.g. a saved "$1" entry chewing into a jiggled
 * "$1,411.80" produced from "$1,234.56".
 * @param {string} text
 * @param {Array<{type:string, original:string, fakeValue:string, enabled:boolean}>} entries
 * @param {{xmlSafe?: boolean}} opts
 */
export function applyEntriesToText(text, entries, opts = {}) {
  const { xmlSafe = false } = opts;
  // Longest originals first, so "John Smith" is replaced as a unit before the
  // derived "John"/"Smith" sub-strings get a chance to break it apart.
  const active = entries
    .filter((entry) => entry && entry.enabled !== false && entry.original)
    .sort((a, b) => b.original.length - a.original.length);
  if (active.length === 0) return text;

  const lookup = new Map();
  for (const entry of active) {
    const key = entry.original.toLowerCase();
    if (!lookup.has(key)) lookup.set(key, entry);
  }

  // Alphanumeric boundaries keep a short entry ("Doe", "4250") from rewriting
  // the middle of a longer word or number it merely appears inside.
  const re = new RegExp(
    active
      .map((entry) => `(?<![A-Za-z0-9])(?:${escapeRegExp(entry.original)})(?![A-Za-z0-9])`)
      .join('|'),
    'gi',
  );
  return text.replace(re, (match) => {
    const entry = lookup.get(match.toLowerCase());
    if (!entry) return match;
    return xmlSafe ? escapeXml(entry.fakeValue) : entry.fakeValue;
  });
}

/** "report.docx" -> "report.sanitized.docx" */
export function sanitizedName(name, ext) {
  const base = String(name || 'file').replace(/\.[^.]+$/, '');
  return `${base}.sanitized.${ext}`;
}
