// DOCX: unzip -> edit word/document.xml text nodes -> re-zip.

import JSZip from 'jszip';
import { applyEntriesToText, sanitizedName } from '../text.js';

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

export async function detect(file) {
  const zip = await loadZip(file);
  const xml = await documentXml(zip, file);
  const nodes = textNodes(xml);
  console.log(`[DOCX Parser] ${file.name}: document.xml is ${xml.length} chars, ${nodes.length} text node(s).`);
  return nodes;
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
