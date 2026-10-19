// Format router: extension -> parser module with { detect, sanitize }.

import * as json from './jsonParser.js';
import * as jsonl from './jsonlParser.js';
import * as xlsx from './xlsxParser.js';
import * as docx from './docxParser.js';
import * as pptx from './pptxParser.js';
import * as pdf from './pdfParser.js';
import * as eml from './emlParser.js';
import * as html from './htmlParser.js';
import * as text from './textParser.js';
import { TEXT_EXTENSIONS } from './textParser.js';

export const ACCEPTED_EXTENSIONS = [
  'docx',
  'pptx',
  'xlsx',
  'xls',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'pdf',
  'eml',
  'html',
  'htm',
  ...TEXT_EXTENSIONS,
];
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');

export function fileExtension(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function getParser(file) {
  switch (fileExtension(file.name)) {
    case 'json':
      return json;
    case 'jsonl':
    case 'ndjson':
      return jsonl;
    case 'xlsx':
    case 'xls':
    case 'csv':
    case 'tsv':
      return xlsx;
    case 'docx':
      return docx;
    case 'pptx':
      return pptx;
    case 'pdf':
      return pdf;
    case 'eml':
      return eml;
    case 'html':
    case 'htm':
      return html;
    default:
      if (TEXT_EXTENSIONS.includes(fileExtension(file.name))) return text;
      throw new Error(
        `Unsupported file type ".${fileExtension(file.name)}". Supported: ${ACCEPTED_EXTENSIONS.join(', ')}`,
      );
  }
}

export function isSupported(file) {
  try {
    getParser(file);
    return true;
  } catch {
    return false;
  }
}
