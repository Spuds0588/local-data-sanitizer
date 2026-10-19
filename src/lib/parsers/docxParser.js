// DOCX: unzip -> read paragraphs and tables -> edit word/document.xml runs -> re-zip.
//
// Text is rewritten per paragraph rather than per run, so a name or email that
// Word split across several `<w:t>` nodes is still one value (see runs.js).

import JSZip from 'jszip';
import { sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue, looksLikeName } from '../columns.js';
import {
  DOCX_PARAGRAPH,
  DOCX_RUN,
  mergedText,
  paragraphText,
  paragraphTexts,
  replaceInParagraphs,
} from './runs.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function loadZip(file) {
  return JSZip.loadAsync(await file.arrayBuffer());
}

async function documentXml(zip, file) {
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error(`Not a valid .docx: word/document.xml missing in "${file.name}".`);
  return entry.async('string');
}

/**
 * Every text-bearing part of the package. Headers/footers and notes carry real
 * PII (letterheads, signatures) and must be scanned and rewritten too.
 */
async function textParts(zip) {
  const names = Object.keys(zip.files).filter(
    (name) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(name) && !zip.files[name].dir,
  );
  const parts = [];
  for (const name of names) parts.push({ name, xml: await zip.file(name).async('string') });
  return parts;
}

const TITLE_STOPWORDS = new Set([
  'curriculum vitae', 'resume', 'cv', 'confidential', 'draft', 'invoice',
  'statement', 'report', 'agreement', 'contract', 'letter', 'memo', 'notes',
  'summary', 'profile', 'application', 'form', 'proposal',
]);

/**
 * A Title-styled first paragraph is how resumes, letters and contracts name the
 * person. Style is structure (like a table header), not a guess from prose, so
 * it types the value without scanning every heading in the document.
 */
function titleName(xml, typedValues) {
  const re = new RegExp(DOCX_PARAGRAPH.source, 'g');
  let match;
  while ((match = re.exec(xml)) !== null) {
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(match[1]);
    if (!style || !/^title$/i.test(style[1])) continue;
    const text = paragraphText(match[1], DOCX_RUN);
    if (!text || TITLE_STOPWORDS.has(text.toLowerCase())) continue;
    if (!looksLikeName(text)) continue;
    const item = extractTypedValue('name', text);
    if (item) typedValues.push({ original: item.original, type: item.type, key: 'Title', numeric: false });
  }
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
        cells.push(mergedText(cellMatch[1], DOCX_PARAGRAPH, DOCX_RUN));
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
  const parts = await textParts(zip);
  // Paragraphs, not runs: a value broken over two runs must reach the detector
  // whole, or only one half of it is recognized and the other half survives.
  const segments = parts.flatMap((part) => paragraphTexts(part.xml, DOCX_PARAGRAPH, DOCX_RUN));
  const typedValues = [];
  const moneyNumbers = [];
  titleName(xml, typedValues);

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
      `${segments.length} paragraph(s), ${typedValues.length} typed table cell(s).`,
  );
  return { segments, typedValues, moneyNumbers };
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

export async function sanitize(file, entries) {
  const zip = await loadZip(file);
  const parts = await textParts(zip);
  let before = 0;
  let after = 0;
  for (const part of parts) {
    const updated = replaceInParagraphs(part.xml, {
      paragraphRe: DOCX_PARAGRAPH,
      runRe: DOCX_RUN,
      entries,
      keepSpace: true,
    });
    before += part.xml.length;
    after += updated.length;
    zip.file(part.name, updated);
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
  console.log(`[DOCX Parser] ${file.name}: re-zipped ${parts.length} part(s) (${before} -> ${after} chars).`);
  return { blob, name: sanitizedName(file.name, 'docx') };
}
