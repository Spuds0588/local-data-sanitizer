// XLSX / CSV. Spreadsheets carry the context that free text lacks: a "Balance"
// column makes a bare 4250 money, "Account Number" makes a bare 884201553 an
// account, and "Full Name" makes "Jane Doe" a person.
//
// .xlsx cells are edited in place so number formats and layout survive. CSV is
// read as exact UTF-8 text (see csv.js) so leading zeros and non-ASCII are not
// mangled by a type-guessing parser.

import * as XLSX from 'xlsx';
import { applyEntriesToText, sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue } from '../columns.js';
import { formatCsv, parseCsv } from '../csv.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_HEADER_SCAN = 6;

/** CSV and TSV share the header-typing pipeline; only the delimiter differs. */
function delimitedInfo(name) {
  if (/\.tsv$/i.test(name || '')) {
    return { delimiter: '\t', ext: 'tsv', mime: 'text/tab-separated-values' };
  }
  if (/\.csv$/i.test(name || '')) {
    return { delimiter: ',', ext: 'csv', mime: 'text/csv' };
  }
  return null;
}

async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    cellNF: true, // keep number formats ($#,##0.00) on write
    cellText: true, // .w gives the displayed value for formatted cells
  });
}

/** Raw number for numeric cells, the display string otherwise. */
function cellText(cell) {
  if (!cell) return '';
  if (cell.t === 'n') return String(cell.v ?? '');
  return String(cell.w ?? cell.v ?? '');
}

/** Header columns from a plain row matrix (CSV). */
function rowLayout(rows) {
  for (let r = 0; r < Math.min(rows.length, MAX_HEADER_SCAN); r += 1) {
    let filled = 0;
    const columns = new Map();
    for (let c = 0; c < rows[r].length; c += 1) {
      const text = String(rows[r][c] ?? '').trim();
      if (!text) continue;
      filled += 1;
      const type = classifyHeader(text);
      if (type) columns.set(c, { type, header: text });
    }
    const looksLikeHeader = columns.size >= 2 || (columns.size === 1 && filled === 1 && r === 0);
    if (looksLikeHeader) return { headerRow: r, columns };
  }
  return { headerRow: -1, columns: new Map() };
}

/** Header columns from a worksheet (xlsx). */
export function sheetLayout(ws) {
  const ref = ws && ws['!ref'];
  if (!ref) return { range: null, headerRow: -1, columns: new Map() };
  const range = XLSX.utils.decode_range(ref);
  const rows = [];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + MAX_HEADER_SCAN); r += 1) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })]) );
    }
    rows.push(row);
  }
  const { headerRow, columns } = rowLayout(rows);
  return { range, headerRow: headerRow < 0 ? -1 : range.s.r + headerRow, columns };
}

async function detectCsv(file, info) {
  const rows = parseCsv(await file.text(), info.delimiter);
  const { headerRow, columns } = rowLayout(rows);
  const segments = [];
  const typedValues = [];
  const moneyNumbers = [];
  for (let r = 0; r < rows.length; r += 1) {
    if (r === headerRow) continue;
    for (let c = 0; c < rows[r].length; c += 1) {
      const text = String(rows[r][c] ?? '').trim();
      if (!text) continue;
      segments.push(text);
      if (r <= headerRow) continue;
      const column = columns.get(c);
      if (!column) continue;
      const item = extractTypedValue(column.type, text);
      if (!item) continue;
      if (item.type === 'amount') {
        moneyNumbers.push({ original: item.original, key: column.header, numeric: false });
      } else {
        typedValues.push({ original: item.original, type: item.type, key: column.header, numeric: false });
      }
    }
  }
  console.log(
    `[CSV Parser] ${file.name}: ${rows.length} row(s), ${segments.length} cell(s), ` +
      `${typedValues.length + moneyNumbers.length} typed value(s).`,
  );
  return { segments, typedValues, moneyNumbers };
}

async function detectWorkbook(file) {
  const wb = await readWorkbook(file);
  const segments = [];
  const typedValues = [];
  const moneyNumbers = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    segments.push(name);
    const { range, headerRow, columns } = sheetLayout(ws);
    if (!range) continue;

    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        // Header labels are structure, not data: "Account Number" must not be
        // mistaken for an account number or a name.
        if (r === headerRow) continue;
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const text = cellText(cell).trim();
        if (!text) continue;
        segments.push(text);

        if (r <= headerRow) continue;
        const column = columns.get(c);
        if (!column) continue;
        // Amount cells are read raw (a formatted "$4,850.00" cannot be looked
        // up by the numeric value on write); identifiers keep the display form
        // so leading zeros survive.
        const typedText =
          cell.t === 'n' && column.type !== 'amount' ? String(cell.w ?? cell.v).trim() : text;
        const item = extractTypedValue(column.type, typedText);
        if (!item) continue;
        if (item.type === 'amount') {
          moneyNumbers.push({ original: item.original, key: column.header, numeric: cell.t === 'n' });
        } else {
          typedValues.push({
            original: item.original,
            type: item.type,
            key: column.header,
            numeric: cell.t === 'n',
          });
        }
      }
    }
  }

  console.log(
    `[XLSX Parser] ${file.name}: ${wb.SheetNames.length} sheet(s), ${segments.length} cell(s), ` +
      `${typedValues.length + moneyNumbers.length} typed value(s).`,
  );
  return { segments, typedValues, moneyNumbers };
}

export async function detectWithMeta(file) {
  const info = delimitedInfo(file.name);
  return info ? detectCsv(file, info) : detectWorkbook(file);
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

/** The entry that applies to a cell in a classified column. */
function columnEntry(column, value, lookup) {
  const types = column.type === 'card' ? ['creditCard', 'creditCardPartial'] : [column.type];
  for (const type of types) {
    const entry = lookup.get(`${type}:${value}`);
    if (entry) return entry;
  }
  return null;
}

function buildLookups(entries) {
  const textEntries = entries.filter(
    (entry) => entry && entry.enabled !== false && !entry.numericOnly && entry.original,
  );
  const lookup = new Map();
  const amounts = new Map();
  for (const entry of entries) {
    if (!entry || entry.enabled === false || !entry.original) continue;
    lookup.set(`${entry.type}:${String(entry.original)}`, entry);
    if (entry.type === 'amount') amounts.set(String(entry.original), entry);
  }
  return { textEntries, lookup, amounts };
}

async function sanitizeCsv(file, entries, log, info) {
  const rows = parseCsv(await file.text(), info.delimiter);
  const { headerRow, columns } = rowLayout(rows);
  const { textEntries, lookup } = buildLookups(entries);

  for (let r = 0; r < rows.length; r += 1) {
    // Header labels are schema, not data: rewriting "City" because a payee
    // happened to contain that word would break every reader of the file.
    // Title rows above the header are still content and are scrubbed.
    if (r === headerRow) continue;
    for (let c = 0; c < rows[r].length; c += 1) {
      const text = String(rows[r][c] ?? '');
      if (!text.trim()) continue;
      const column = r > headerRow ? columns.get(c) : null;
      const entry = column ? columnEntry(column, text.trim(), lookup) : null;
      rows[r][c] = entry ? String(entry.fakeValue) : applyEntriesToText(text, textEntries);
    }
  }

  const output = formatCsv(rows, info.delimiter);
  log(`[${info.ext.toUpperCase()} Parser] ${file.name}: exported ${info.ext.toUpperCase()} (${output.length} chars).`);
  return { blob: new Blob([output], { type: info.mime }), name: sanitizedName(file.name, info.ext) };
}

async function sanitizeWorkbook(file, entries, log) {
  const wb = await readWorkbook(file);
  const { textEntries, lookup, amounts } = buildLookups(entries);
  const renamed = new Map();

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const { range, headerRow, columns } = sheetLayout(ws);
    if (range) {
      for (let r = range.s.r; r <= range.e.r; r += 1) {
        for (let c = range.s.c; c <= range.e.c; c += 1) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell) continue;
          // Column headers are structure; never rewrite them.
          if (r === headerRow) continue;
          const column = r > headerRow ? columns.get(c) : null;

          if (cell.t === 'n') {
            const raw = String(cell.v);
            if (column && column.type === 'amount') {
              const entry = amounts.get(raw);
              if (entry && Number.isFinite(Number(entry.fakeValue))) {
                cell.v = Number(entry.fakeValue);
                delete cell.w;
              }
              continue;
            }
            if (column) {
              const display = String(cell.w ?? cell.v).trim();
              const entry = columnEntry(column, display, lookup) || columnEntry(column, raw, lookup);
              if (entry) {
                const fake = String(entry.fakeValue);
                if (/^-?\d+(?:\.\d+)?$/.test(fake)) {
                  cell.v = Number(fake);
                } else {
                  cell.t = 's';
                  cell.v = fake;
                  delete cell.z;
                }
                delete cell.w;
              }
            }
            continue;
          }

          const text = String(cell.v ?? '');
          if (!text.trim()) continue;
          const entry = column ? columnEntry(column, text.trim(), lookup) : null;
          const next = entry ? String(entry.fakeValue) : applyEntriesToText(text, textEntries);
          if (next !== text) {
            cell.v = next;
            delete cell.w;
          }
        }
      }
    }
    const safeName = applyEntriesToText(name, textEntries).slice(0, 31) || 'Sheet';
    renamed.set(name, safeName);
  }

  // Rename sheets last, de-duplicating the 31-character truncation collisions.
  const used = new Set();
  for (const [name, desired] of renamed) {
    let safe = desired;
    let i = 2;
    while (used.has(safe.toLowerCase())) {
      const suffix = ` (${i})`;
      safe = `${desired.slice(0, 31 - suffix.length)}${suffix}`;
      i += 1;
    }
    used.add(safe.toLowerCase());
    if (safe !== name) {
      wb.Sheets[safe] = wb.Sheets[name];
      delete wb.Sheets[name];
      wb.SheetNames[wb.SheetNames.indexOf(name)] = safe;
    }
  }

  const array = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellNF: true });
  log(`[XLSX Parser] ${file.name}: exported XLSX (${array.byteLength} bytes).`);
  return { blob: new Blob([array], { type: XLSX_MIME }), name: sanitizedName(file.name, 'xlsx') };
}

export async function sanitize(file, entries, log = () => {}) {
  const info = delimitedInfo(file.name);
  return info ? sanitizeCsv(file, entries, log, info) : sanitizeWorkbook(file, entries, log);
}
