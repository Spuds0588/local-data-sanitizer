// PDF: extract the text layer with pdf.js -> output plain .txt (by design, V1).

import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { applyEntriesToText, sanitizedName } from '../text.js';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

async function extractPages(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).filter((s) => s && s.trim()));
  }
  await loadingTask.destroy();
  return pages;
}

export async function detect(file) {
  const pages = await extractPages(file);
  const out = pages.flat();
  console.log(`[PDF Parser] ${file.name}: ${pages.length} page(s), ${out.length} text segment(s) extracted.`);
  return out;
}

export async function sanitize(file, entries) {
  const pages = await extractPages(file);
  const text = pages
    .map((segments, i) => `--- Page ${i + 1} ---\n${segments.map((s) => applyEntriesToText(s, entries)).join('\n')}`)
    .join('\n\n');
  console.log(`[PDF Parser] ${file.name}: exported plaintext (${text.length} chars).`);
  return { blob: new Blob([text], { type: 'text/plain' }), name: sanitizedName(file.name, 'txt') };
}
