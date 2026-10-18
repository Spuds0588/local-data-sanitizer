import { describe, expect, it } from 'vitest';
import * as pdfParser from '../parsers/pdfParser.js';

/** Build a minimal, valid, uncompressed single-page PDF containing `text`. */
function buildPdf(text) {
  const escaped = text.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 24 Tf 72 700 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

describe('pdfParser', () => {
  it('extracts the text layer and outputs plaintext .txt', async () => {
    const file = new File([buildPdf('Email john@acme.com now')], 'doc.pdf', { type: 'application/pdf' });
    const texts = await pdfParser.detect(file);
    expect(texts.join(' ')).toContain('john@acme.com');

    const { blob, name } = await pdfParser.sanitize(file, [
      { id: 'e1', type: 'email', original: 'john@acme.com', fakeValue: 'fake@x.com', enabled: true },
    ]);
    expect(name).toBe('doc.sanitized.txt');
    const out = await blob.text();
    expect(out).toContain('fake@x.com');
    expect(out).toContain('--- Page 1 ---');
    expect(out).not.toContain('john@acme.com');
  });
});
