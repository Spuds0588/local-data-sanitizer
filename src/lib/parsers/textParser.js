// Plain-text family: .txt / .md / .log / .vcf / .ics / .xml / .yaml / .ini /
// .env / .ldif / .sql / .srt / .vtt.
//
// These formats have no cell grid to type values from, but they do have
// structure: `Label: value` lines, `key=value` fields, vCard properties and
// iCalendar parameters. We read that structure for detection, then replace only
// the exact values in the original text. Nothing is reflowed or rebuilt, so the
// document keeps its layout, line endings and calendar folding. (Email and HTML
// have their own parsers.)

import { applyEntriesToText, sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue, looksLikeName } from '../columns.js';

const MIME = {
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  log: 'text/plain',
  vcf: 'text/vcard',
  ics: 'text/calendar',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  ldif: 'text/plain',
  sql: 'application/sql',
  srt: 'text/plain',
  vtt: 'text/vtt',
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
// A quoted value may contain spaces (`city="São Paulo"`), so prefer the
// quoted form over the bare one; otherwise the value would be cut at the space
// and only "São" would be typed.
const PAIR = /(?:^|[\s;,&?])([A-Za-z][A-Za-z0-9_]{1,30})=(?:"([^"]*)"|'([^']*)'|([^\s;,&]+))/g;
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
      const raw = (match[2] ?? match[3] ?? match[4] ?? '').trim();
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

// XML/SOAP exports put the field name in the tag or the attribute, which is
// the same signal a CSV header gives. Only leaf elements (no child markup) are
// read, and the file is still rewritten by plain literal replacement, so tags,
// namespaces, indentation and declarations stay untouched.
const XML_ELEMENT = /<([A-Za-z][\w.:-]*)\b[^<>]*>([^<>]+)<\/\1\s*>/g;
const XML_ATTRIBUTE = /\b([A-Za-z][\w.:-]*)\s*=\s*"([^"<>]+)"/g;
const XML_SKIP_ATTRIBUTES = new Set(['xmlns', 'version', 'encoding', 'schemaLocation', 'noNamespaceSchemaLocation']);

function localName(name) {
  return String(name).split(':').pop();
}

function xmlValues(text, typedValues) {
  XML_ELEMENT.lastIndex = 0;
  let match;
  while ((match = XML_ELEMENT.exec(text)) !== null) {
    const type = classifyHeader(localName(match[1]));
    if (type) addTyped(typedValues, type, match[2], localName(match[1]));
  }
  XML_ATTRIBUTE.lastIndex = 0;
  while ((match = XML_ATTRIBUTE.exec(text)) !== null) {
    const name = localName(match[1]);
    if (XML_SKIP_ATTRIBUTES.has(name)) continue;
    const type = classifyHeader(name);
    if (type) addTyped(typedValues, type, match[2], name);
  }
}

/**
 * Split one `VALUES (...), (...)` list. Quoted strings are unescaped (`''` and
 * `\'`) so the typed value matches the real data; the position tracking is only
 * needed to know where the statement ends.
 */
function sqlTuples(text, start) {
  const tuples = [];
  let i = start;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== '(') break;
    i += 1;
    const values = [];
    let value = '';
    let quoted = false;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === "'") {
          if (text[i + 1] === "'") {
            value += "'";
            i += 1;
          } else {
            quoted = false;
          }
        } else if (ch === '\\' && text[i + 1] === "'") {
          value += "'";
          i += 1;
        } else {
          value += ch;
        }
      } else if (ch === "'") {
        quoted = true;
      } else if (ch === ',') {
        values.push(value);
        value = '';
      } else if (ch === ')') {
        values.push(value);
        i += 1;
        break;
      } else {
        value += ch;
      }
    }
    tuples.push(values.map((cell) => cell.trim()));
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== ',') break;
    i += 1;
  }
  return tuples;
}

/**
 * Split a CREATE TABLE body / an INSERT column list on commas that are not
 * inside parentheses (`decimal(10,2)`, `enum('a','b')`).
 */
function splitColumns(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(text)) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function columnName(definition) {
  const match = /^\s*[`"[]?([A-Za-z_][\w$]*)[`"\]]?/.exec(definition);
  return match ? match[1] : '';
}

const SQL_RESERVED_COLUMNS = /^\s*(?:PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL|CHECK)\b/i;
const SQL_CREATE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([\w.]+)[`"\]]?\s*\(([\s\S]*?)\)\s*(?:ENGINE\b|DEFAULT\s+CHARSET|CHARSET\b|;)/gi;
const SQL_INSERT = /\bINSERT\s+INTO\s+[`"[]?([\w.]+)[`"\]]?\s*(?:\(([^)]*)\))?\s*VALUES\s*/gi;

function tableKey(name) {
  return String(name).replace(/[`"\[\]]/g, '').split('.').pop().toLowerCase();
}

/**
 * `INSERT INTO customers (first_name, email) VALUES (…)` names every column.
 * A mysqldump `INSERT INTO customers VALUES (…)` omits the list, so the order
 * comes from the CREATE TABLE in the same dump — otherwise every value would
 * be invisible to the column typing.
 */
function sqlValues(text, typedValues) {
  const tables = new Map();
  SQL_CREATE.lastIndex = 0;
  let create;
  while ((create = SQL_CREATE.exec(text)) !== null) {
    const columns = splitColumns(create[2])
      .filter((definition) => !SQL_RESERVED_COLUMNS.test(definition))
      .map(columnName)
      .filter(Boolean);
    if (columns.length) tables.set(tableKey(create[1]), columns);
  }

  SQL_INSERT.lastIndex = 0;
  let match;
  while ((match = SQL_INSERT.exec(text)) !== null) {
    const columns = match[2]
      ? match[2].split(',').map((column) => columnName(column))
      : tables.get(tableKey(match[1])) || [];
    if (!columns.length) continue;
    const types = columns.map((column) => classifyHeader(column));
    if (!types.some(Boolean)) continue;
    for (const row of sqlTuples(text, SQL_INSERT.lastIndex)) {
      row.forEach((value, index) => {
        if (types[index] && value && value.toUpperCase() !== 'NULL') {
          addTyped(typedValues, types[index], value, columns[index]);
        }
      });
    }
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
  if (/\.xml$/i.test(file.name)) xmlValues(text, typedValues);
  if (/\.sql$/i.test(file.name)) sqlValues(text, typedValues);
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
  // A fake may contain `&` or `<`; in XML those must be escaped or the
  // document stops parsing. SQL needs the same care with apostrophes.
  const output = applyEntriesToText(text, textEntries, {
    xmlSafe: /\.xml$/i.test(file.name),
    sqlSafe: /\.sql$/i.test(file.name),
  });
  const ext = (/\.[^.]+$/.exec(file.name)?.[0] || '.txt').slice(1).toLowerCase();
  console.log(`[Text Parser] ${file.name}: ${text.length} -> ${output.length} chars.`);
  return {
    blob: new Blob([output], { type: MIME[ext] || 'text/plain' }),
    name: sanitizedName(file.name, ext || 'txt'),
  };
}
