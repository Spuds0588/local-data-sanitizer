// XLSX / CSV via SheetJS (SheetJS 0.20.x, not the vulnerable npm 0.18.5).

import * as XLSX from 'xlsx';
import { applyEntriesToText, sanitizedName } from '../text.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isCsv(name) {
  return /\.csv$/i.test(name || '');
}

async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array', cellDates: false });
}

function sheetMatrix(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
}

export async function detect(file) {
  const wb = await readWorkbook(file);
  const out = [];
  for (const name of wb.SheetNames) {
    out.push(name);
    for (const row of sheetMatrix(wb.Sheets[name])) {
      for (const cell of row) {
        if (cell !== null && cell !== undefined && cell !== '') out.push(String(cell));
      }
    }
  }
  console.log(`[XLSX Parser] ${file.name}: ${wb.SheetNames.length} sheet(s), ${out.length} cell(s)/name(s) collected.`);
  return out;
}

export async function sanitize(file, entries) {
  const wb = await readWorkbook(file);
  const outWb = XLSX.utils.book_new();

  for (const name of wb.SheetNames) {
    const rows = sheetMatrix(wb.Sheets[name]).map((row) =>
      row.map((cell) => applyEntriesToText(cell === null || cell === undefined ? '' : String(cell), entries)),
    );
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const safeName = applyEntriesToText(name, entries).slice(0, 31) || 'Sheet';
    XLSX.utils.book_append_sheet(outWb, ws, safeName);
  }

  if (isCsv(file.name)) {
    const csv = XLSX.utils.sheet_to_csv(outWb.Sheets[outWb.SheetNames[0]]);
    console.log(`[XLSX Parser] ${file.name}: exported CSV (${csv.length} chars).`);
    return { blob: new Blob([csv], { type: 'text/csv' }), name: sanitizedName(file.name, 'csv') };
  }

  const array = XLSX.write(outWb, { bookType: 'xlsx', type: 'array' });
  console.log(`[XLSX Parser] ${file.name}: exported XLSX (${array.byteLength} bytes).`);
  return { blob: new Blob([array], { type: XLSX_MIME }), name: sanitizedName(file.name, 'xlsx') };
}
