// Format router: extension -> parser module with { detect, sanitize }.

import * as json from './jsonParser.js';
import * as xlsx from './xlsxParser.js';
import * as docx from './docxParser.js';
import * as pdf from './pdfParser.js';

export const ACCEPTED_EXTENSIONS = ['docx', 'xlsx', 'xls', 'csv', 'json', 'pdf'];
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');

export function fileExtension(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function getParser(file) {
  switch (fileExtension(file.name)) {
    case 'json':
      return json;
    case 'xlsx':
    case 'xls':
    case 'csv':
      return xlsx;
    case 'docx':
      return docx;
    case 'pdf':
      return pdf;
    default:
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
