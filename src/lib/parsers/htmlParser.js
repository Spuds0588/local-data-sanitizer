// HTML: statements, CRM pages and exported reports. The file is edited as
// markup — only text nodes and a few attribute values change, so tables,
// classes, links and scripts stay exactly where they were.
//
// Tables are structure: an HTML table header names its columns just like a
// spreadsheet header, which is what turns a bare `MRN-77420` or `Jane Doe`
// into a typed value. Label/value layouts (`<th>Phone</th><td>…</td>`) work the
// same way.

import { applyEntriesToText, sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue } from '../columns.js';

const MIME = 'text/html';

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  euro: '€',
  pound: '£',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text that is actually visible/readable, without script or style bodies. */
function visibleText(html) {
  return String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
}

function textNodes(html) {
  const out = [];
  const re = />([^<]*)</g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const text = decodeEntities(match[1]).trim();
    if (text) out.push(text);
  }
  return out;
}

const ATTR_RE = /(\b(?:href|src|alt|title|value|content|placeholder|data-[a-z0-9-]+)=)(["'])([\s\S]*?)\2/gi;

function attributeValues(html) {
  const out = [];
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(html)) !== null) {
    const value = decodeEntities(match[3]).trim();
    if (value) out.push(value.replace(/^mailto:/i, ''));
  }
  return out;
}

function addTyped(typedValues, type, raw, key) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 200) return;
  const item = extractTypedValue(type, value);
  if (item) typedValues.push({ original: item.original, type: item.type, key, numeric: false });
}

export function htmlTables(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let table;
  while ((table = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let row;
    while ((row = rowRe.exec(table[1])) !== null) {
      const cells = [];
      const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cell;
      while ((cell = cellRe.exec(row[1])) !== null) {
        cells.push({ tag: cell[1].toLowerCase(), text: stripTags(cell[2]), inner: cell[2] });
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

export async function detectWithMeta(file) {
  const html = await file.text();
  const segments = [...textNodes(visibleText(html)), ...attributeValues(html)];
  const typedValues = [];

  for (const rows of htmlTables(html)) {
    // A `<thead>` of `<th>` cells is the header. Without one, a first row whose
    // cells all classify (`Customer | Email | SSN`) is still a header; a
    // two-column label/value table (`<th>Phone</th><td>…</td>`) is not.
    let headerIndex = rows.findIndex((cells) => cells.length > 0 && cells.every((cell) => cell.tag === 'th'));
    if (headerIndex < 0) {
      const first = rows[0] || [];
      if (first.length >= 2 && first.every((cell) => classifyHeader(cell.text))) headerIndex = 0;
    }
    const headers = headerIndex >= 0 ? rows[headerIndex].map((cell) => classifyHeader(cell.text)) : [];

    rows.forEach((cells, index) => {
      if (index === headerIndex) return;
      // Label/value row (`<th>Email</th><td>…</td>`): type the value.
      if (cells.length === 2) {
        const labelType = classifyHeader(cells[0].text);
        if (labelType) {
          addTyped(typedValues, labelType, cells[1].text, cells[0].text);
          return;
        }
      }
      if (headerIndex < 0) return;
      cells.forEach((cell, column) => {
        const type = headers[column];
        if (type) addTyped(typedValues, type, cell.text, rows[headerIndex][column]?.text);
      });
    });
  }

  console.log(
    `[HTML Parser] ${file.name}: ${html.length} chars, ${segments.length} text value(s), ` +
      `${typedValues.length} typed table cell(s).`,
  );
  return { segments, typedValues };
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

export async function sanitize(file, entries) {
  const html = await file.text();
  const active = entries.filter((entry) => entry && entry.enabled !== false && !entry.numericOnly);

  const withText = html.replace(/>([^<]*)</g, (match, text) =>
    text.trim() ? `>${applyEntriesToText(text, active, { xmlSafe: true })}<` : match,
  );

  const withAttributes = withText.replace(ATTR_RE, (match, name, quote, value) => {
    const decoded = decodeEntities(value);
    const replaced = applyEntriesToText(decoded, active, { xmlSafe: true }).replace(/"/g, '&quot;');
    return replaced === decoded ? match : `${name}${quote}${replaced}${quote}`;
  });

  console.log(`[HTML Parser] ${file.name}: ${html.length} -> ${withAttributes.length} chars.`);
  return {
    blob: new Blob([withAttributes], { type: MIME }),
    name: sanitizedName(file.name, /\.html?$/i.test(file.name) ? 'html' : 'html'),
  };
}
