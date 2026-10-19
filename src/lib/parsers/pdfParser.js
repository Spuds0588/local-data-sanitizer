// PDF: extract the text layer with pdf.js -> output plain .txt (by design, V1).
//
// PDF does not store lines, it stores positioned glyph runs. A single name or
// email is routinely emitted as several runs ("jane.d" then "oe@example.com"),
// so replacing run by run misses the value. Runs that share a baseline are
// rebuilt into one line first, inserting a space only where the gap between
// runs is wide enough to be a real space.

import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { applyEntriesToText, sanitizedName } from '../text.js';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * Runs on one baseline -> one readable line. `width` and `transform` are in the
 * same user-space units, so the gap between runs is directly comparable to the
 * font size.
 */
export function groupLines(items) {
  const lines = [];
  let line = null;
  const flush = () => {
    if (!line) return;
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
    line = null;
  };

  for (const item of items) {
    const str = item.str || '';
    if (!str) continue;
    const transform = item.transform || [];
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const size = Math.abs(item.height || transform[3] || 10) || 10;

    if (!line || Math.abs(y - line.y) > size * 0.6) {
      flush();
      line = { y, text: '', endX: null };
    }

    let piece = str;
    if (line.text && line.endX !== null) {
      const gap = x - line.endX;
      // A gap narrower than a space is kerning or a formatting split inside a
      // word, so the pieces are joined with nothing between them.
      if (gap > size * 0.2 && !/\s$/.test(line.text) && !/^\s/.test(piece)) piece = ` ${piece}`;
    }
    line.text += piece;
    line.endX = x + (item.width || 0);
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

async function extractPages(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(groupLines(content.items));
  }
  await loadingTask.destroy();
  return pages;
}

export async function detect(file) {
  const pages = await extractPages(file);
  const out = pages.flat();
  console.log(`[PDF Parser] ${file.name}: ${pages.length} page(s), ${out.length} line(s) extracted.`);
  return out;
}

export async function sanitize(file, entries) {
  const pages = await extractPages(file);
  const text = pages
    .map((lines, i) => `--- Page ${i + 1} ---\n${lines.map((line) => applyEntriesToText(line, entries)).join('\n')}`)
    .join('\n\n');
  console.log(`[PDF Parser] ${file.name}: exported plaintext (${text.length} chars).`);
  return { blob: new Blob([text], { type: 'text/plain' }), name: sanitizedName(file.name, 'txt') };
}
