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
 * `custom` and `email` matches are case-insensitive so "John Doe" and "john doe"
 * resolve to the same fake value (referential integrity).
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
  let out = text;
  for (const entry of active) {
    const ci = entry.type === 'custom' || entry.type === 'email';
    const value = xmlSafe ? escapeXml(entry.fakeValue) : entry.fakeValue;
    out = replaceAll(out, entry.original, value, ci);
  }
  return out;
}

/** "report.docx" -> "report.sanitized.docx" */
export function sanitizedName(name, ext) {
  const base = String(name || 'file').replace(/\.[^.]+$/, '');
  return `${base}.sanitized.${ext}`;
}
