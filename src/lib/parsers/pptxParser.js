// PPTX: unzip -> read slide/notes text and tables -> edit the text runs -> re-zip.
//
// A deck is a zip of XML parts exactly like DOCX; only the element names differ
// (`a:t` text runs, `a:tbl` tables). Replacement is still node-by-node literal
// substitution, so layouts, themes, images, charts and speaker notes stay put.

import JSZip from 'jszip';
import { applyEntriesToText, sanitizedName } from '../text.js';
import { classifyHeader, extractTypedValue, looksLikeName } from '../columns.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const PART_RE = /^ppt\/(?:slides\/slide|notesSlides\/notesSlide|slideLayouts\/slideLayout|slideMasters\/slideMaster)\d*\.xml$/;

async function loadZip(file) {
  return JSZip.loadAsync(await file.arrayBuffer());
}

function textRuns(xml) {
  const out = [];
  const re = /<a:t>([^<]*)<\/a:t>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    if (match[1] && match[1].trim()) out.push(match[1]);
  }
  return out;
}

/** Replace only text-run content, leaving tags, attributes and metadata alone. */
function replaceTextRuns(xml, entries) {
  return xml.replace(/(<a:t>)([^<]*)(<\/a:t>)/g, (_full, open, text, close) =>
    `${open}${text ? applyEntriesToText(text, entries, { xmlSafe: true }) : text}${close}`,
  );
}

async function textParts(zip) {
  const names = Object.keys(zip.files).filter((name) => PART_RE.test(name) && !zip.files[name].dir);
  const parts = [];
  for (const name of names) parts.push({ name, xml: await zip.file(name).async('string') });
  return parts;
}

/** Tables: rows (`a:tr`) of cells (`a:tc`), each a run of `a:t` text. */
export function slideTables(xml) {
  const tables = [];
  const tableRe = /<a:tbl>([\s\S]*?)<\/a:tbl>/g;
  let tableMatch;
  while ((tableMatch = tableRe.exec(xml)) !== null) {
    const rows = [];
    const rowRe = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
      const cells = [];
      const cellRe = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(textRuns(cellMatch[1]).join(' ').replace(/\s+/g, ' ').trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

/** A title placeholder is the deck equivalent of a Title-styled DOCX paragraph. */
function titleNames(xml, typedValues) {
  const shapes = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let shape;
  while ((shape = shapes.exec(xml)) !== null) {
    if (!/<p:ph[^>]*type="(?:title|ctrTitle)"/.test(shape[1])) continue;
    const text = textRuns(shape[1]).join(' ').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 60 || !looksLikeName(text)) continue;
    const item = extractTypedValue('name', text);
    if (item) typedValues.push({ original: item.original, type: item.type, key: 'Title', numeric: false });
  }
}

export async function detectWithMeta(file) {
  const zip = await loadZip(file);
  const parts = await textParts(zip);
  if (parts.length === 0) throw new Error(`Not a valid .pptx: no slides found in "${file.name}".`);

  const segments = parts.flatMap((part) => textRuns(part.xml));
  const typedValues = [];
  const moneyNumbers = [];
  for (const part of parts) {
    if (!/\/slides\/slide\d*\.xml$/.test(part.name)) continue;
    titleNames(part.xml, typedValues);
    for (const rows of slideTables(part.xml)) {
      const headers = rows[0].map((cell) => classifyHeader(cell));
      if (headers.filter(Boolean).length < 2) continue;
      for (const row of rows.slice(1)) {
        row.forEach((cell, i) => {
          if (!cell || !headers[i]) return;
          const item = extractTypedValue(headers[i], cell);
          if (!item) return;
          const target = item.type === 'amount' ? moneyNumbers : typedValues;
          target.push({ original: item.original, type: item.type, key: 'table', numeric: false });
        });
      }
    }
  }

  console.log(
    `[PPTX Parser] ${file.name}: ${parts.length} part(s), ${segments.length} text run(s), ` +
      `${typedValues.length} typed cell(s).`,
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
    const updated = replaceTextRuns(part.xml, entries);
    before += part.xml.length;
    after += updated.length;
    zip.file(part.name, updated);
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: PPTX_MIME, compression: 'DEFLATE' });
  console.log(`[PPTX Parser] ${file.name}: re-zipped ${parts.length} part(s) (${before} -> ${after} chars).`);
  return { blob, name: sanitizedName(file.name, 'pptx') };
}
