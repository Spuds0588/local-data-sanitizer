// DOCX: unzip -> read paragraphs and tables -> edit word/document.xml text nodes -> re-zip.

import JSZip from 'jszip';
import { applyEntriesToText, sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue } from '../columns.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function loadZip(file) {
  return JSZip.loadAsync(await file.arrayBuffer());
}

/** Only the text between ">" and "<" is real document content, never XML tags. */
function replaceTextNodes(xml, entries) {
  return xml.replace(/>([^<]*)</g, (_full, text) => `>${applyEntriesToText(text, entries, { xmlSafe: true })}<`);
}

function textNodes(xml) {
  const out = [];
  const re = />([^<]*)</g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] && m[1].trim()) out.push(m[1]);
  }
  return out;
}

async function documentXml(zip, file) {
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error(`Not a valid .docx: word/document.xml missing in "${file.name}".`);
  return entry.async('string');
}

/**
 * Rows of `<w:tbl>` tables as arrays of cell text. A table is structured data:
 * its first row names the columns, so "Beneficiary" / "Email" can type the
 * cells beneath them even though a bare "Jane Doe" looks like any other words.
 */
export function documentTables(xml) {
  const tables = [];
  const tableRe = /<w:tbl>([\s\S]*?)<\/w:tbl>/g;
  let tableMatch;
  while ((tableMatch = tableRe.exec(xml)) !== null) {
    const rows = [];
    const rowRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
      const cells = [];
      const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(textNodes(cellMatch[1]).join(' ').replace(/\s+/g, ' ').trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

export async function detectWithMeta(file) {
  const zip = await loadZip(file);
  const xml = await documentXml(zip, file);
  const segments = textNodes(xml);
  const typedValues = [];
  const moneyNumbers = [];

  for (const rows of documentTables(xml)) {
    const headers = rows[0].map((cell) => classifyHeader(cell));
    if (headers.filter(Boolean).length < 2) continue;
    for (const row of rows.slice(1)) {
      row.forEach((cell, i) => {
        if (!cell || !headers[i]) return;
        const item = extractTypedValue(headers[i], cell);
        if (!item) return;
        if (item.type === 'amount') moneyNumbers.push({ original: item.original, key: 'table', numeric: false });
        else typedValues.push({ original: item.original, type: item.type, key: 'table', numeric: false });
      });
    }
  }

  console.log(
    `[DOCX Parser] ${file.name}: document.xml is ${xml.length} chars, ` +
      `${segments.length} text node(s), ${typedValues.length} typed table cell(s).`,
  );
  return { segments, typedValues, moneyNumbers };
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

export async function sanitize(file, entries) {
  const zip = await loadZip(file);
  const xml = await documentXml(zip, file);
  const updated = replaceTextNodes(xml, entries);
  zip.file('word/document.xml', updated);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
  console.log(`[DOCX Parser] ${file.name}: re-zipped document.xml (${xml.length} -> ${updated.length} chars).`);
  return { blob, name: sanitizedName(file.name, 'docx') };
}
