// Plain-text family: .txt / .md / .log / .eml / .vcf / .ics / .xml / .html.
//
// These formats have no cell grid to type values from, but they do have
// structure: `Label: value` lines, email headers, vCard properties and iCalendar
// parameters. We read that structure for detection, then replace only the exact
// values in the original text. Nothing is reflowed, re-encoded or rebuilt, so
// the document keeps its layout, line endings, MIME boundaries and calendar
// folding.

import { applyEntriesToText, sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue, looksLikeName } from '../columns.js';

const MIME = {
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  log: 'text/plain',
  eml: 'message/rfc822',
  vcf: 'text/vcard',
  ics: 'text/calendar',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
};

export const TEXT_EXTENSIONS = Object.keys(MIME);

function addTyped(typedValues, type, raw, key) {
  // Markdown puts the colon inside the emphasis (`**MRN:** value`), so the
  // closing markers land in the captured value and must be peeled back off.
  const value = String(raw ?? '')
    .trim()
    .replace(/^(?:\*\*|__)\s*/, '')
    .replace(/\s*(?:\*\*|__)$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!value) return;
  const item = extractTypedValue(type, value);
  if (item) typedValues.push({ original: item.original, type: item.type, key, numeric: false });
}

// `Label: value` / `**Label:** value` / `# Patient: Name` / `user_id=…`.
const LABEL_LINE = /^\s*(?:[>#]+\s*|[-*+]\s+)?(?:\*\*|__)?([A-Za-z][A-Za-z0-9 /_.#()'’-]{1,40}?)(?:\*\*|__)?\s*[:=]\s*(.+?)\s*$/;
const PAIR = /(?:^|[\s;,&?])([A-Za-z][A-Za-z0-9_]{1,30})=([^\s;,&]+)/g;
const PAIR_SKIP = new Set([
  'http', 'https', 'href', 'src', 'class', 'style', 'width', 'height',
  'version', 'charset', 'boundary', 'xmlns', 'type', 'level', 'size',
]);

/** `Label: value` lines are structure: they type a bare value the regexes miss. */
function typedLabelLines(text, typedValues) {
  for (const line of text.split(/\r?\n/)) {
    const match = LABEL_LINE.exec(line);
    if (!match) continue;
    const type = classifyHeader(match[1]);
    if (!type) continue;
    const value = match[2];
    if (value.length > 160) continue;
    addTyped(typedValues, type, value, match[1].trim());
  }
}

/**
 * `user_id=USR-88213` inside a log line (not only at the start of one). Logs
 * and event exports label their fields this way, and an opaque ID or phone is
 * invisible to the regexes without the key.
 */
function typedKeyValues(text, typedValues) {
  for (const line of text.split(/\r?\n/)) {
    PAIR.lastIndex = 0;
    let match;
    while ((match = PAIR.exec(line)) !== null) {
      const key = match[1];
      if (PAIR_SKIP.has(key.toLowerCase())) continue;
      const raw = match[2].replace(/["']$/, '');
      if (raw.length < 3 || raw.length > 160) continue;
      const type = classifyHeader(key);
      if (!type) continue;
      addTyped(typedValues, type, raw, key);
    }
  }
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().replace(/^\*\*|\*\*$/g, '').trim());
}

/**
 * Markdown pipe tables are the DOCX table equivalent: the header row names the
 * columns, so a bare `MRN-77420` or `Aisha Rahman` in a cell is typed even
 * though the same text in prose would need a label.
 */
function typedMarkdownTables(text, typedValues) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].trim().startsWith('|') || !TABLE_SEPARATOR.test(lines[i + 1])) continue;
    const headers = tableCells(lines[i]).map((cell) => classifyHeader(cell));
    if (headers.filter(Boolean).length === 0) continue;
    let row = i + 2;
    for (; row < lines.length && lines[row].trim().startsWith('|'); row += 1) {
      tableCells(lines[row]).forEach((cell, c) => {
        if (!cell || !headers[c]) return;
        addTyped(typedValues, headers[c], cell, 'table');
      });
    }
    i = row - 1;
  }
}

const LIST_LABELS = new Set(['attendees', 'participants', 'present', 'recipients', 'to', 'cc', 'bcc', 'invitees', 'members']);

/** `Attendees: A, B` / `To: A <a@x>, B <b@x>` list names, not one blob. */
function typedNameLists(text, typedValues) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z]+):\s*(.+)$/.exec(line);
    if (!match) continue;
    if (!LIST_LABELS.has(match[1].toLowerCase())) continue;
    const value = match[2];
    const parts = value.includes(';') ? value.split(';') : value.split(/,(?![^<]*>)/);
    for (const part of parts) {
      const display = /^\s*"?([^"<]+?)"?\s*<[^>]+>/.exec(part);
      const name = (display ? display[1] : part).trim().replace(/^["']|["']$/g, '');
      if (name && looksLikeName(name)) addTyped(typedValues, 'name', name, match[1]);
    }
  }
}

function unfolded(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function emailHeaders(text, typedValues) {
  const end = text.search(/\r?\n\r?\n/);
  const head = unfolded(end === -1 ? text : text.slice(0, end));
  const wanted = /^(From|To|Cc|Bcc|Reply-To|Sender):\s*(.*)$/i;
  for (const line of head.split(/\r?\n/)) {
    const match = wanted.exec(line);
    if (!match) continue;
    for (const part of match[2].split(/,(?![^<]*>)/)) {
      const display = /^\s*"?([^"<]+?)"?\s*<[^>]+>/.exec(part);
      if (!display) continue;
      const name = display[1].trim().replace(/^"|"$/g, '');
      if (looksLikeName(name)) addTyped(typedValues, 'name', name, match[1]);
    }
  }
}

function vcardValues(text, typedValues) {
  let formattedName = '';
  let structuredName = '';
  for (const line of unfolded(text).split(/\r?\n/)) {
    const match = /^(?:item\d+\.)?([A-Z-]+)(?:;[^:]*)?:(.*)$/i.exec(line);
    if (!match) continue;
    const property = match[1].toUpperCase();
    const value = match[2].trim();
    if (!value) continue;

    // FN is the display name; N is its structured components. Add one full name
    // so token expansion maps "Doe" and "Jane" to the same fake in both lines.
    if (property === 'FN') formattedName = value;
    else if (property === 'N') {
      // Doe;Jane;Quinn;Dr.;Jr.
      const [last, first, middle, prefix, suffix] = value.split(';');
      structuredName = [prefix, first, middle, last, suffix].filter(Boolean).join(' ');
    } else if (property === 'ORG') addTyped(typedValues, 'organization', value.split(';')[0], 'ORG');
    else if (property === 'TEL') addTyped(typedValues, 'phone', value, 'TEL');
    else if (property === 'EMAIL') addTyped(typedValues, 'email', value, 'EMAIL');
    else if (property === 'BDAY') addTyped(typedValues, 'dob', value, 'BDAY');
    else if (property === 'URL') addTyped(typedValues, 'profileUrl', value, 'URL');
    else if (property === 'ADR') {
      // PO box;extended;street;city;state;postal;country
      const [, , street, city, , postal] = value.split(';');
      addTyped(typedValues, 'address', street, 'ADR');
      addTyped(typedValues, 'city', city, 'ADR');
      addTyped(typedValues, 'postalCode', postal, 'ADR');
    }
  }
  // Prefer the N components: a structured name carries the middle name too, so
  // every token the FN line uses is mapped once (and the N line stays
  // consistent with the FN line) instead of splitting into two fakes.
  const canonicalName = structuredName.trim().split(/\s+/).length >= 2 ? structuredName : formattedName;
  if (canonicalName) addTyped(typedValues, 'name', canonicalName, 'FN');
}

function icsValues(text, typedValues) {
  for (const line of unfolded(text).split(/\r?\n/)) {
    const match = /^([A-Z-]+)(?:;([^:]*))?:(.*)$/i.exec(line);
    if (!match) continue;
    const property = match[1].toUpperCase();
    const params = match[2] || '';
    const value = match[3].trim();
    if (property === 'ORGANIZER' || property === 'ATTENDEE') {
      const cn = /(?:^|;)CN=("?)([^";:]+)\1(?:;|$)/i.exec(params);
      if (cn && looksLikeName(cn[2])) addTyped(typedValues, 'name', cn[2], property);
    } else if (property === 'LOCATION') {
      addTyped(typedValues, 'address', value, 'LOCATION');
    }
  }
}

export async function detectWithMeta(file) {
  const text = await file.text();
  const typedValues = [];
  const segments = [text];

  typedLabelLines(text, typedValues);
  typedKeyValues(text, typedValues);
  typedNameLists(text, typedValues);
  typedMarkdownTables(text, typedValues);
  if (/\.eml$/i.test(file.name)) emailHeaders(text, typedValues);
  if (/\.vcf$/i.test(file.name)) vcardValues(text, typedValues);
  if (/\.ics$/i.test(file.name)) icsValues(text, typedValues);

  console.log(
    `[Text Parser] ${file.name}: ${text.length} chars, ${typedValues.length} typed value(s).`,
  );
  return { segments, typedValues };
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

const FOLDABLE = /\.(ics|vcf)$/i;

/**
 * vCard/iCalendar fold long lines at 75 octets with a leading space. A value
 * split by a fold (a long email address, a street address) would otherwise
 * escape replacement, so these two formats are unfolded, sanitized and folded
 * back. Both RFCs allow refolding: the calendar/contact still parses the same.
 */
function foldLines(text, eol) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.length <= 75) return line;
      const chunks = [line.slice(0, 75)];
      for (let i = 75; i < line.length; i += 74) chunks.push(` ${line.slice(i, i + 74)}`);
      return chunks.join(eol);
    })
    .join(eol);
}

export async function sanitize(file, entries) {
  const text = await file.text();
  // Numeric-only entries come from numeric leaves and must not rewrite digits
  // inside prose.
  const textEntries = entries.filter((entry) => entry && entry.enabled !== false && !entry.numericOnly);
  const folded = FOLDABLE.test(file.name);
  if (folded) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const trailing = /\r?\n$/.test(text);
    const body = trailing ? text.replace(/\r?\n$/, '') : text;
    const unfoldedText = body.replace(/\r?\n[ \t]/g, '');
    const replaced = applyEntriesToText(unfoldedText, textEntries);
    const output = foldLines(replaced, eol) + (trailing ? eol : '');
    console.log(`[Text Parser] ${file.name}: ${text.length} -> ${output.length} chars (refolded).`);
    const ext = (/\.[^.]+$/.exec(file.name)?.[0] || '.txt').slice(1).toLowerCase();
    return {
      blob: new Blob([output], { type: MIME[ext] || 'text/plain' }),
      name: sanitizedName(file.name, ext || 'txt'),
    };
  }
  const output = applyEntriesToText(text, textEntries);
  const ext = (/\.[^.]+$/.exec(file.name)?.[0] || '.txt').slice(1).toLowerCase();
  console.log(`[Text Parser] ${file.name}: ${text.length} -> ${output.length} chars.`);
  return {
    blob: new Blob([output], { type: MIME[ext] || 'text/plain' }),
    name: sanitizedName(file.name, ext || 'txt'),
  };
}
