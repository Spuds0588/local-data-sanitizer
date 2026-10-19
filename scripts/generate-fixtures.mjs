// Generate the synthetic sensitive-data corpus used by the fixture leak test.
//
// Everything here is fake, but shaped like the real exports people feed to an
// LLM: a bank transaction log, an accounting workbook, a user export, a KYC
// profile, a statement PDF and a support inbox. Each file ships with the exact
// values that must be gone after sanitizing (fixtures/manifest.json).
//
// Run with: npm run fixtures

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  cpfComplete,
  luhnCheckDigit,
  nhsCheckDigit,
  tfnValid,
  verhoeffDigit,
} from '../src/lib/identifiers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'fixtures');

const manifest = { generatedBy: 'scripts/generate-fixtures.mjs', files: [] };

function addFile(name, secrets) {
  const seen = new Set();
  const unique = [];
  for (const secret of secrets) {
    const value = String(secret.value);
    const match = secret.match || 'text';
    const key = `${match}:${value}`;
    // Zero is not a secret and no replacement can change it.
    if (!value || seen.has(key) || (match === 'number' && Number(value) === 0)) continue;
    seen.add(key);
    unique.push({ value, match });
  }
  manifest.files.push({ name, secrets: unique });
}

const text = (value) => ({ value, match: 'text' });
const number = (value) => ({ value, match: 'number' });

// ---------------------------------------------------------------- CSV helper
function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '');
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\n') + '\n';
}

// --------------------------------------------------------- bank transactions
const ACCOUNT = '004211889301';
const ACCOUNT_OTHER = '553100287';
const ROUTING = '021000021';
const ROUTING_OTHER = '325081403';
const CARD = '4111111111111111';

const bankRows = [
  ['Date', 'Description', 'Payee', 'Account Number', 'Routing Number', 'Card Number', 'Debit', 'Credit', 'Balance', 'Reference'],
  ['2024-01-02', 'SALARY ACME CORP', 'Acme Corporation', ACCOUNT, ROUTING, '', '', '4850.00', '4850.00', 'TXN-88213'],
  ['2024-01-03', 'TRANSFER TO JANE DOE', 'Jane Doe', ACCOUNT, ROUTING, '', '750.00', '', '4100.00', 'TXN-88214'],
  ['2024-01-05', 'POS PURCHASE WHOLE FOODS #1042', 'Whole Foods Market', ACCOUNT, ROUTING, CARD, '128.45', '', '3971.55', 'TXN-88215'],
  ['2024-01-06', 'RENT PAYMENT WESTBROOK PROPERTIES', 'Westbrook Properties', ACCOUNT, ROUTING, '', '2200.00', '', '1771.55', 'TXN-88216'],
  ['2024-01-10', 'TRANSFER FROM ROBERT CHEN', 'Robert Chen', ACCOUNT, ROUTING, '', '', '300.00', '2071.55', 'TXN-88217'],
  ['2024-01-12', 'DENTAL INSURANCE REFUND HARBOR DENTAL LLC', 'Harbor Dental LLC', ACCOUNT, ROUTING, '', '', '95.25', '2166.80', 'TXN-88218'],
  ['2024-01-15', 'CARD PAYMENT CITY POWER & LIGHT', 'City Power & Light', ACCOUNT, ROUTING, CARD, '410.00', '', '1756.80', 'TXN-88219'],
  ['2024-01-18', 'CONSULTING INVOICE 1001 NORTHWIND TRADERS', 'Northwind Traders', ACCOUNT, ROUTING, '', '', '1250.00', '3006.80', 'TXN-88220'],
  ['2024-01-22', 'GROCERY WHOLE FOODS #1042', 'Whole Foods Market', ACCOUNT, ROUTING, '', '86.20', '', '2920.60', 'TXN-88221'],
  ['2024-01-25', 'PAYROLL ACME CORPORATION', 'Acme Corporation', ACCOUNT_OTHER, ROUTING_OTHER, '', '', '1850.00', '4770.60', 'TXN-88222'],
  ['2024-01-26', 'TRANSFER TO PRIYA NATARAJAN', 'Priya Natarajan', ACCOUNT, ROUTING, '', '500.00', '', '4270.60', 'TXN-88223'],
  ['2024-01-28', 'PAYMENT BLUE CROSS BLUE SHIELD', 'Blue Cross Blue Shield', ACCOUNT, ROUTING, '', '640.00', '', '3630.60', 'TXN-88224'],
  ['2024-01-29', 'TRANSFER TO LUIS ORTEGA', 'Luis Ortega', ACCOUNT, ROUTING, '', '250.00', '', '3380.60', 'TXN-88225'],
  ['2024-01-31', 'MONTHLY MAINTENANCE FEE', 'Northwest Community Bank', ACCOUNT, ROUTING, '', '12.00', '', '3368.60', 'TXN-88226'],
];

const bankPayees = [...new Set(bankRows.slice(1).map((row) => row[2]))];
const bankAmounts = [...new Set(bankRows.slice(1).flatMap((row) => [row[6], row[7], row[8]]).filter((value) => value && value !== '0.00'))];
const bankRefs = bankRows.slice(1).map((row) => row[9]);

addFile('bank-transactions.csv', [
  ...bankPayees.map(text),
  ...bankAmounts.map(number),
  ...bankRefs.map(text),
  text(ACCOUNT),
  text(ACCOUNT_OTHER),
  text(ROUTING),
  text(ROUTING_OTHER),
  text(CARD),
]);

// ------------------------------------------------------- accounting workbook
const invoices = [
  ['Invoice #', 'Customer', 'Contact Email', 'Phone', 'Tax ID', 'IBAN', 'Invoice Amount', 'Balance Due', 'Due Date', 'Notes'],
  ['INV-1001', 'Harbor Dental LLC', 'billing@harbordental.example', '(206) 555-0142', '91-2837465', 'GB82WEST12345698765432', 12500, 12500, '2024-02-15', 'Net 30. PO 4471.'],
  ['INV-1002', 'Jane Doe', 'jane.doe@example.com', '206-555-0177', '47-3928174', 'DE89370400440532013000', 8450.75, 0, '2024-02-20', 'Paid in full.'],
  ['INV-1003', 'Robert Chen', 'robert.chen@example.com', '415-555-0193', '82-1938475', 'FR1420041010050500013M02606', 3200, 1600, '2024-03-01', 'Partial payment received.'],
  ['INV-1004', 'Northwind Traders', 'ap@northwind.example', '503-555-0128', '61-8473920', 'NL91ABNA0417164300', 18900, 18900, '2024-03-05', 'Net 45.'],
  ['INV-1005', 'Priya Natarajan', 'priya.n@example.com', '312-555-0164', '39-2847561', 'ES9121000418450200051332', 4750.5, 0, '2024-03-10', 'Complete.'],
  ['INV-1006', 'Westbrook Properties', 'accounts@westbrook.example', '720-555-0119', '84-7362519', 'IT60X0542811101000000123456', 5400, 5400, '2024-03-15', 'Rent.'],
];

const customers = [
  ['Customer ID', 'Full Name', 'Email', 'Phone', 'Address', 'Date of Birth', 'SSN', 'Account Number', 'Credit Limit', 'Notes'],
  ['CUST-1042', 'Marcus Webb', 'marcus.webb@example.com', '+1 (415) 555-0138', '742 Evergreen Terrace, Springfield, IL 62704', '1986-04-17', '573-91-2244', '884201553', 25000, 'Prefers email. SSN on file 573-91-2244.'],
  ['CUST-1043', 'Jane Doe', 'jane.doe@example.com', '+1 (206) 555-0177', '88 Cedar Hollow Lane, Portland, OR 97205', '1979-11-02', '412-88-7315', '553100287', 15000, 'Net 30 terms.'],
  ['CUST-1044', 'Robert Chen', 'robert.chen@example.com', '+1 (415) 555-0193', '15 Beacon Street, Boston, MA 02108', '1992-08-23', '627-44-9018', '771904326', 8000, 'Auto-pay enrolled.'],
  ['CUST-1045', 'Priya Natarajan', 'priya.n@example.com', '+1 (312) 555-0164', '2210 Lakeshore Drive, Chicago, IL 60614', '1988-01-30', '508-63-4420', '663028914', 12000, 'Quarterly billing.'],
];

function workbookBuffer() {
  const wb = XLSX.utils.book_new();
  const invoiceSheet = XLSX.utils.aoa_to_sheet(invoices);
  for (let r = 1; r < invoices.length; r += 1) {
    for (const col of ['G', 'H']) invoiceSheet[`${col}${r + 1}`].z = '$#,##0.00';
  }
  XLSX.utils.book_append_sheet(wb, invoiceSheet, 'Invoices');

  const customerSheet = XLSX.utils.aoa_to_sheet(customers);
  for (let r = 1; r < customers.length; r += 1) customerSheet[`I${r + 1}`].z = '$#,##0.00';
  XLSX.utils.book_append_sheet(wb, customerSheet, 'Customers');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', cellNF: true });
}

const invoiceSecrets = invoices.slice(1).flatMap((row) => [
  text(row[1]), text(row[2]), text(row[3]), text(row[4]), text(row[5]),
  number(row[6]), number(row[7]),
]);
const customerSecrets = customers.slice(1).flatMap((row) => [
  text(row[0]), text(row[1]), text(row[2]), text(row[3]), text(row[4]), text(row[5]),
  text(row[6]), text(row[7]), number(row[8]),
]);
addFile('accounts-receivable.xlsx', [...invoiceSecrets, ...customerSecrets]);

// ------------------------------------------------------------- user export
const users = [
  {
    user_id: 'USR-88213',
    full_name: 'Marcus Webb',
    email: 'marcus.webb@example.com',
    phone: '+1 (415) 555-0138',
    ssn: '573-91-2244',
    date_of_birth: '1986-04-17',
    address: { line1: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', postal_code: '62704' },
    ip_address: '203.0.113.42',
    account_number: 884201553,
    routing_number: ROUTING,
    credit_card: '4111 1111 1111 1111',
    password: 'Winter2024!',
    api_key: 'sk-proj-9f3a2b7c4d8e1f6a0b5c9d2e7f4a1b8c',
    aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
    github_token: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
    credit_limit: 25000,
    balance: 4250,
    is_active: true,
  },
  {
    user_id: 'USR-88214',
    full_name: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1 (206) 555-0177',
    ssn: '412-88-7315',
    date_of_birth: '1979-11-02',
    address: { line1: '88 Cedar Hollow Lane', city: 'Portland', state: 'OR', postal_code: '97205' },
    ip_address: '198.51.100.17',
    account_number: '553100287',
    routing_number: ROUTING_OTHER,
    credit_card: '5500 0000 0000 0004',
    password: 'hunter2-Plum-91',
    api_key: 'sk-live-7c2b9e4d1a8f3e6b0c5d9a2f4e7b1c3d',
    credit_limit: 15000,
    balance: 3120.5,
    is_active: true,
  },
  {
    user_id: 'USR-88215',
    full_name: 'Robert Chen',
    email: 'robert.chen@example.com',
    phone: '+1 (415) 555-0193',
    ssn: '627-44-9018',
    date_of_birth: '1992-08-23',
    address: { line1: '15 Beacon Street', city: 'Boston', state: 'MA', postal_code: '02108' },
    ip_address: '192.0.2.88',
    account_number: 771904326,
    routing_number: ROUTING,
    credit_card: '4111 1111 1111 1111',
    password: 'Beacon#2024!',
    api_key: 'sk-proj-2b8d4e6f1a3c5e7b9d0f2a4c6e8b1d3f',
    credit_limit: 8000,
    balance: 0,
    is_active: false,
  },
  {
    user_id: 'USR-88216',
    full_name: 'Priya Natarajan',
    email: 'priya.n@example.com',
    phone: '+1 (312) 555-0164',
    ssn: '508-63-4420',
    date_of_birth: '1988-01-30',
    address: { line1: '2210 Lakeshore Drive', city: 'Chicago', state: 'IL', postal_code: '60614' },
    ip_address: '203.0.113.99',
    account_number: '663028914',
    routing_number: ROUTING,
    credit_card: '5500 0000 0000 0004',
    password: 'Lakeshore-88!',
    api_key: 'sk-live-5a1c3e7b9d2f4a6c8e0b2d4f6a8c1e3b',
    credit_limit: 12000,
    balance: 1875.25,
    is_active: true,
  },
];

const jsonSecrets = users.flatMap((user) => [
  text(user.user_id), text(user.full_name), text(user.email), text(user.phone), text(user.ssn),
  text(user.date_of_birth), text(user.address.line1), text(user.address.city), text(user.address.postal_code),
  text(user.ip_address), text(user.account_number), text(user.routing_number), text(user.credit_card),
  text(user.password), text(user.api_key),
  ...(user.aws_access_key_id ? [text(user.aws_access_key_id), text(user.github_token)] : []),
  number(user.credit_limit), number(user.balance),
]);
addFile('user-export.json', jsonSecrets);

// ------------------------------------------------------------ KYC DOCX
function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const paragraph = (value) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`;
const table = (rows) =>
  `<w:tbl>${rows
    .map((row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`)
    .join('')}</w:tbl>`;

const kycParagraphs = [
  'Customer Profile — Confidential',
  'Full name: Marcus Webb',
  'Date of birth: 04/17/1986',
  'SSN: 573-91-2244',
  'Passport No: 512345678',
  "Driver's License: WDL-8842193",
  'Email: marcus.webb@example.com',
  'Phone: +1 (415) 555-0138',
  'Residential address: 742 Evergreen Terrace, Springfield, IL 62704',
  'Employer: Northwind Traders',
  'Annual income: $148,500.00',
  'Account Number: 884201553',
  'Routing Number: 021000021',
  'IBAN: GB82WEST12345698765432',
  'IP address: 203.0.113.42',
  'Spouse: Jane Doe',
  'Spouse first name only: Jane',
  'Primary card on file: **** **** **** 1111',
  'Notes: prefers contact by email. Verify identity before any wire transfer.',
];
const kycTable = [
  ['Beneficiary', 'Email', 'Phone', 'Share'],
  ['Jane Doe', 'jane.doe@example.com', '(206) 555-0177', '50%'],
  ['Robert Chen', 'robert.chen@example.com', '(415) 555-0193', '50%'],
];

async function docxBuffer() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      kycParagraphs.map(paragraph).join('') +
      table(kycTable) +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>',
  );
  // Fixed zip timestamps keep the committed fixture byte-stable across runs.
  return zip.generateAsync({ type: 'nodebuffer', date: new Date('2024-01-01T00:00:00Z') });
}

addFile('kyc-profile.docx', [
  text('Marcus Webb'), text('04/17/1986'), text('573-91-2244'), text('512345678'),
  text('WDL-8842193'), text('marcus.webb@example.com'), text('+1 (415) 555-0138'),
  text('742 Evergreen Terrace, Springfield, IL 62704'), text('Northwind Traders'),
  number('148500.00'), text('884201553'), text('021000021'), text('GB82WEST12345698765432'),
  text('203.0.113.42'), text('Jane Doe'), text('Jane'), text('**** **** **** 1111'),
  text('jane.doe@example.com'), text('(206) 555-0177'), text('Robert Chen'),
  text('robert.chen@example.com'), text('(415) 555-0193'),
]);

// ------------------------------------------------------------------ PPTX deck
// A board deck: the title placeholder carries a name and a table lists contacts;
// the speaker notes carry a phone number. Everything else (theme, layout, notes
// part) is kept byte-for-byte.
// The title placeholder names the candidate; the body carries the deck topic.
// That is the deck equivalent of a resume Title line, and it is what lets the
// same name be scrubbed in the speaker notes below.
const deckTitle = 'Priya Natarajan';
const deckSubtitle = 'Q1 hiring review — confidential';
const deckRows = [
  ['Full Name', 'Email', 'Phone', 'Department'],
  ['Diego Marques', 'diego.marques@contoso.example', '+1 (415) 555-0142', 'Finance'],
  ['Amara Okafor', 'amara.okafor@contoso.example', '+44 20 7946 0123', 'Engineering'],
];
const deckNotes = 'Follow up with Priya Natarajan on (415) 555-0199 before Friday.';

function pptxBuffer() {
  const zip = new JSZip();
  const escapeXml = (value) =>
    String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (value) =>
    `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${escapeXml(value)}</a:t></a:r></a:p></a:txBody></a:tc>`;
  const row = (cells) => `<a:tr h="370840">${cells.map(cell).join('')}</a:tr>`;
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'ppt/presentation.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'ppt/slides/slide1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<p:cSld><p:spTree>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
      `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${escapeXml(deckTitle)}</a:t></a:r></a:p></p:txBody></p:sp>` +
      '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${escapeXml(deckSubtitle)}</a:t></a:r></a:p></p:txBody></p:sp>` +
      '<p:graphicFrame><a:graphic><a:graphicData><a:tbl>' +
      deckRows.map(row).join('') +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>' +
      '</p:spTree></p:cSld></p:sld>',
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      `<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(deckNotes)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', date: new Date('2024-01-01T00:00:00Z') });
}

addFile('board-deck.pptx', [
  text('Priya Natarajan'), text('Diego Marques'), text('diego.marques@contoso.example'),
  text('+1 (415) 555-0142'), text('Amara Okafor'), text('amara.okafor@contoso.example'),
  text('+44 20 7946 0123'), text('(415) 555-0199'),
]);

// ----------------------------------------------------------- statement PDF
const pdfLines = [
  'NORTHWEST COMMUNITY BANK',
  'Statement of Account',
  'Account Holder: Marcus Webb',
  'Account Number: 884201553',
  'Routing Number: 021000021',
  'Address: 742 Evergreen Terrace, Springfield, IL 62704',
  'Email: marcus.webb@example.com  Phone: +1 (415) 555-0138',
  'Statement Period: 2024-01-01 to 2024-01-31',
  'Opening Balance: $4,850.00',
  '01/03 TRANSFER TO JANE DOE -$750.00 Balance $4,100.00',
  '01/05 POS PURCHASE WHOLE FOODS MARKET #1042 -$128.45 Balance $3,971.55',
  '01/10 TRANSFER FROM ROBERT CHEN $300.00 Balance $2,071.55',
  '01/18 PAYROLL ACME CORPORATION $1,250.00 Balance $3,006.80',
  '01/26 TRANSFER TO PRIYA NATARAJAN -$500.00 Balance $4,270.60',
  'Closing Balance: $3,368.60',
  'Card on file: **** **** **** 1111',
  'Questions? Call (415) 555-0138 or email marcus.webb@example.com',
];

function pdfBuffer(lines) {
  const escape = (value) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content =
    'BT /F1 10 Tf 50 750 Td 14 TL\n' +
    lines.map((line) => `(${escape(line)}) Tj T*`).join('\n') +
    '\nET';
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

addFile('statement.pdf', [
  text('Marcus Webb'), text('884201553'), text('021000021'),
  text('742 Evergreen Terrace, Springfield, IL 62704'), text('marcus.webb@example.com'),
  text('+1 (415) 555-0138'), text('(415) 555-0138'),
  number('4850.00'), number('4100.00'), number('750.00'), number('128.45'), number('3971.55'),
  number('300.00'), number('2071.55'), number('1250.00'), number('3006.80'),
  number('500.00'), number('4270.60'), number('3368.60'),
  text('Jane Doe'), text('Whole Foods'), text('Robert Chen'), text('Acme Corporation'),
  text('Priya Natarajan'), text('**** **** **** 1111'),
]);

// ----------------------------------------------------------- support inbox
const supportRows = [
  ['ticket_id', 'created_at', 'channel', 'message', 'agent', 'customer_email'],
  [
    'TKT-4411',
    '2024-02-03T14:22:00Z',
    'email',
    "Hi, I'm Jane Doe. My card ending in 1111 was charged twice. Call me at (206) 555-0177 or jane.doe@example.com. My SSN is 123-45-6789 and my account number is 553100287. I live at 88 Cedar Hollow Lane, Portland, OR 97205. Password: Winter2024!",
    'Dana Whitfield',
    'jane.doe@example.com',
  ],
  [
    'TKT-4412',
    '2024-02-03T16:05:00Z',
    'chat',
    'This is Marcus Webb (marcus.webb@example.com). Please update my address to 742 Evergreen Terrace, Springfield, IL 62704. My API key sk-proj-9f3a2b7c4d8e1f6a0b5c9d2e7f4a1b8c stopped working and my IP is 198.51.100.17.',
    'Luis Ortega',
    'marcus.webb@example.com',
  ],
  [
    'TKT-4413',
    '2024-02-04T09:41:00Z',
    'email',
    'Robert Chen here — SSN 627-44-9018, DOB 08/23/1992. Wire to IBAN NL91ABNA0417164300. Thanks.',
    'Dana Whitfield',
    'robert.chen@example.com',
  ],
];

addFile('support-tickets.csv', [
  ...supportRows.slice(1).flatMap((row) => [text(row[0]), text(row[3]), text(row[4]), text(row[5])]),
  text('Jane Doe'), text('ending in 1111'), text('(206) 555-0177'), text('jane.doe@example.com'),
  text('123-45-6789'), text('553100287'), text('88 Cedar Hollow Lane, Portland, OR 97205'),
  text('Winter2024!'), text('Marcus Webb'), text('marcus.webb@example.com'),
  text('742 Evergreen Terrace, Springfield, IL 62704'),
  text('sk-proj-9f3a2b7c4d8e1f6a0b5c9d2e7f4a1b8c'), text('198.51.100.17'),
  text('Robert Chen'), text('627-44-9018'), text('08/23/1992'), text('NL91ABNA0417164300'),
  text('Dana Whitfield'), text('Luis Ortega'),
]);

// -------------------------------------------------------- payroll register (TSV)
// A tab-separated HR/payroll export: split first/last name columns, bare SSNs,
// month-name and ISO dates, and the only phone number buried in a note.
const payrollRows = [
  ['Employee ID', 'First Name', 'Last Name', 'Work Email', 'SSN', 'Date of Birth', 'Home Address', 'City', 'State', 'ZIP', 'Bank Account', 'Routing Number', 'Annual Salary', 'Notes'],
  ['EMP-2041', 'Elena', 'Vasquez', 'elena.vasquez@northwind.example', '412887315', 'April 17, 1986', '1187 Juniper Way', 'Boise', 'ID', '83702', '441900273', '021000021', '85000', 'Emergency contact: Rosa Vasquez, 208-555-0141'],
  ['EMP-2042', 'Tomas', 'Brandt', 'tomas.brandt@northwind.example', '508-63-9917', '11/02/1979', '44 Alder Court', 'Austin', 'TX', '78701', '603118452', '325081403', '92000', 'Reach Tomas at 512-555-0188'],
  ['EMP-2043', 'Aisha', 'Rahman', 'aisha.rahman@northwind.example', '627449018', '1992-08-23', '902 Birch Street', 'Denver', 'CO', '80202', '771904326', '021000021', '118000', 'Payroll contact: Dana Whitfield'],
];

const payrollSecrets = payrollRows.slice(1).flatMap((row) => [
  text(row[0]), text(row[1]), text(row[2]), text(`${row[1]} ${row[2]}`), text(row[3]),
  text(row[4]), text(row[5]), text(row[6]), text(row[7]), text(row[9]),
  text(row[10]), text(row[11]), number(row[12]),
]);
addFile('payroll-register.tsv', [
  ...payrollSecrets,
  text('Rosa Vasquez'), text('208-555-0141'), text('512-555-0188'), text('Dana Whitfield'),
]);

// ------------------------------------------------------------- CRM event stream (JSONL)
const crmContact = {
  id: 'CNT-5521',
  full_name: 'Nadia Okafor',
  first_name: 'Nadia',
  last_name: 'Okafor',
  email: 'nadia.okafor@riverside.example',
  phone: '+1 (617) 555-0110',
  date_of_birth: 'March 3, 1990',
  ssn: '219-88-4433',
  company: 'Riverside Analytics',
  linkedin: 'https://www.linkedin.com/in/nadiaokafor',
  address: { line1: '410 Maple Grove Avenue', city: 'Cambridge', state: 'MA', postal_code: '02139' },
  credit_limit: 18000,
  balance: 0,
};

const crmLines = [
  { event: 'contact.created', at: '2024-02-05T11:02:00Z', actor: 'Dana Whitfield', contact: crmContact },
  {
    event: 'note.added',
    at: '2024-02-05T11:09:00Z',
    contact_id: 'CNT-5521',
    author: 'Dana Whitfield',
    body: 'Left voicemail on 617-555-0110. Backup number 617-555-0199. SSN on file 219-88-4433.',
  },
  { event: 'deal.updated', at: '2024-02-06T08:31:00Z', contact_id: 'CNT-5521', amount: 4800, stage: 'negotiation' },
  { event: 'contact.updated', at: '2024-02-06T08:33:00Z', contact_id: 'CNT-5521', field: 'balance', balance: 4250 },
];

addFile('crm-events.jsonl', [
  text(crmContact.id), text(crmContact.full_name), text(crmContact.first_name), text(crmContact.last_name),
  text(crmContact.email), text(crmContact.phone), text(crmContact.date_of_birth), text(crmContact.ssn),
  text(crmContact.company), text(crmContact.linkedin), text(crmContact.address.line1),
  text(crmContact.address.city), text(crmContact.address.postal_code), number(crmContact.credit_limit),
  text('Dana Whitfield'), text('617-555-0110'), text('617-555-0199'), number(4800), number(4250),
]);

// ------------------------------------------------------------- email thread (.eml)
// CRLF + multipart boundaries: the sanitizer must not reflow or re-encode it.
const eml = [
  'From: "Camille Dubois" <camille.dubois@northwind.example>',
  'To: "Priya Natarajan" <priya.n@example.com>',
  'Cc: Marcus Webb <marcus.webb@example.com>',
  'Subject: Re: refund for card ending in 4021',
  'Date: Tue, 06 Feb 2024 09:14:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="----=_Part_1234"',
  '',
  '------=_Part_1234',
  'Content-Type: text/plain; charset="utf-8"',
  '',
  'Hi Priya,',
  '',
  'The refund for the card ending in 4021 is on its way. I can be reached at',
  '617-555-0110 or camille.dubois@northwind.example. My SSN is 684-77-2109 and my',
  'date of birth is 07/09/1984.',
  '',
  'Please post the cheque to 85 Harbor View Road, Portland, ME 04101.',
  '',
  'Thanks,',
  'Camille Dubois',
  '------=_Part_1234',
  'Content-Type: text/html; charset="utf-8"',
  '',
  '<html><body><p>Hi Priya,</p><p>Call <a href="tel:617-555-0110">617-555-0110</a> or email',
  'camille.dubois@northwind.example.</p><p>Thanks,<br>Camille Dubois</p></body></html>',
  '------=_Part_1234--',
  '',
].join('\r\n');

addFile('support-thread.eml', [
  text('Camille Dubois'), text('camille.dubois@northwind.example'),
  text('Priya Natarajan'), text('priya.n@example.com'),
  text('Marcus Webb'), text('marcus.webb@example.com'),
  text('ending in 4021'), text('617-555-0110'),
  text('684-77-2109'), text('07/09/1984'),
  text('85 Harbor View Road, Portland, ME 04101'),
]);

// ---------------------------------------------------------------- contacts (.vcf)
const vcf = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Okafor;Nadia;Amara;;',
  'FN:Nadia Okafor',
  'ORG:Riverside Analytics',
  'TITLE:Head of Partnerships',
  'TEL;TYPE=CELL:+1 (617) 555-0110',
  'EMAIL;TYPE=WORK:nadia.okafor@riverside.example',
  'BDAY:1990-03-03',
  'ADR;TYPE=HOME:;;410 Maple Grove Avenue;Cambridge;MA;02139;USA',
  'URL:https://www.linkedin.com/in/nadiaokafor',
  'END:VCARD',
  '',
].join('\r\n');

addFile('contacts.vcf', [
  text('Nadia Okafor'), text('Okafor'), text('Nadia'), text('Amara'),
  text('Riverside Analytics'), text('+1 (617) 555-0110'),
  text('nadia.okafor@riverside.example'), text('1990-03-03'),
  text('410 Maple Grove Avenue'), text('Cambridge'), text('02139'),
  text('https://www.linkedin.com/in/nadiaokafor'),
]);

// ------------------------------------------------------------- calendar invite (.ics)
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Northwind//Calendar//EN',
  'BEGIN:VEVENT',
  'UID:7f2c1d9e-4a6b-4c8d-9e0f-1a2b3c4d5e6f',
  'DTSTAMP:20240201T090000Z',
  'DTSTART:20240315T140000Z',
  'DTEND:20240315T150000Z',
  'SUMMARY:Benefits review with Camille Dubois',
  'ORGANIZER;CN=Camille Dubois:mailto:camille.dubois@northwind.example',
  'ATTENDEE;CN=Nadia Okafor;ROLE=REQ-PARTICIPANT:mailto:nadia.okafor@riverside.example',
  'LOCATION:410 Maple Grove Avenue, Cambridge, MA 02139',
  'DESCRIPTION:Call 617-555-0110 for the dial-in. Questions to camille.dubois@northwind\r\n .example.',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

addFile('team-calendar.ics', [
  text('Camille Dubois'), text('camille.dubois@northwind.example'),
  text('Nadia Okafor'), text('nadia.okafor@riverside.example'),
  text('410 Maple Grove Avenue, Cambridge, MA 02139'), text('617-555-0110'),
]);

// ------------------------------------------------------- patient notes (.md)
const markdown = [
  '# Patient: Aisha Rahman',
  '',
  '**MRN:** MRN-77420',
  '**Member ID:** HP-44821-07',
  '**Date of birth:** January 30, 1988',
  '**Phone:** (303) 555-0164',
  '**Email:** aisha.rahman@example.org',
  '**Address:** 902 Birch Street, Denver, CO 80202',
  '**Payer:** BlueRidge Health Plan',
  '**Primary care:** Dana Whitfield',
  '',
  '## Visit summary',
  '',
  'Aisha presented for a routine follow-up. Insurance is billed through BlueRidge Health Plan.',
  '',
  '| Visit date | Physician | MRN | Diagnosis |',
  '| --- | --- | --- | --- |',
  '| 2024-01-09 | Dana Whitfield | MRN-77420 | J06.9 |',
  '| 2024-01-23 | Dana Whitfield | MRN-77420 | Z00.00 |',
  '',
  'Refer billing questions to billing@blueridge.example or call (303) 555-0164.',
  '',
].join('\n');

addFile('patient-notes.md', [
  text('Aisha Rahman'), text('Aisha'), text('MRN-77420'), text('HP-44821-07'),
  text('January 30, 1988'), text('(303) 555-0164'), text('aisha.rahman@example.org'),
  text('902 Birch Street, Denver, CO 80202'), text('BlueRidge Health Plan'),
  text('Dana Whitfield'), text('billing@blueridge.example'),
]);

// ------------------------------------------------------------- application log (.log)
const accessLog = [
  '203.0.113.77 - - [03/Feb/2024:14:22:00 +0000] "POST /api/login HTTP/1.1" 200 512 "-" "Mozilla/5.0"',
  '2024-02-03T14:22:05Z WARN auth user_id=USR-88213 email=nadia.okafor@riverside.example ip=198.51.100.17 status=ok',
  '2024-02-03T14:22:09Z INFO transfer user_id=USR-88213 amount=1250.00 currency=USD',
  '2024-02-03T14:22:11Z ERROR api call failed reason=expired_token',
  '2024-02-03T14:22:12Z ERROR api retry Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJVU1ItODgyMTMifQ.7xQ2m9pL0vR4sT8wY1zA6bC3dE5f',
  '2024-02-03T14:23:40Z INFO contact phone=(617)555-0110 owner=nadia.okafor@riverside.example',
  '',
].join('\n');

addFile('access.log', [
  text('203.0.113.77'), text('USR-88213'), text('nadia.okafor@riverside.example'),
  text('198.51.100.17'), number('1250.00'),
  text('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJVU1ItODgyMTMifQ.7xQ2m9pL0vR4sT8wY1zA6bC3dE5f'),
  text('(617)555-0110'),
]);

// ------------------------------------------------- international claims (CSV)
// One export, six national identifier schemes, international phones, an EU
// postcode and two addresses that do not use a US street suffix.
function validTfn(seed) {
  for (let i = 0; i < 10; i += 1) if (tfnValid(`${seed}${i}`)) return `${seed}${i}`;
  return `${seed}9`;
}

const NHS_FIRST = '943476591';
const NHS_NUMBER = `${NHS_FIRST.slice(0, 3)} ${NHS_FIRST.slice(3, 6)} ${NHS_FIRST.slice(6)}${nhsCheckDigit(NHS_FIRST)}`;
const CPF_FULL = cpfComplete('529982247');
const CPF_NUMBER = `${CPF_FULL.slice(0, 3)}.${CPF_FULL.slice(3, 6)}.${CPF_FULL.slice(6, 9)}-${CPF_FULL.slice(9)}`;
const AADHAAR_BODY = '23412341234';
const AADHAAR_NUMBER = `${AADHAAR_BODY.slice(0, 4)} ${AADHAAR_BODY.slice(4, 8)} ${AADHAAR_BODY.slice(8)}${verhoeffDigit(AADHAAR_BODY)}`;
const SIN_BODY = '04645476';
const SIN_NUMBER = `${SIN_BODY.slice(0, 3)}-${SIN_BODY.slice(3, 6)}-${SIN_BODY.slice(6)}${luhnCheckDigit(SIN_BODY)}`;
const TFN_BODY = '12345678';
const TFN_SEED = validTfn(TFN_BODY);
const TFN_NUMBER = `${TFN_SEED.slice(0, 3)} ${TFN_SEED.slice(3, 6)} ${TFN_SEED.slice(6)}`;
const NI_NUMBER = 'AB 12 34 56 C';

const claimRows = [
  ['Claim ID', 'Member Name', 'Date of Birth', 'NI Number', 'NHS Number', 'CPF', 'Aadhaar', 'SIN', 'TFN', 'Phone', 'Address', 'Postcode', 'Payout', 'Notes'],
  ['CLM-8801', 'Owen Pritchard', '1968-03-12', NI_NUMBER, NHS_NUMBER, '', '', '', '', '+44 20 7946 0958', '14 Elm Grove', 'M14 5TQ', '2450.00', 'Callback on 0161 496 0123.'],
  ['CLM-8802', 'Mariana Silva', '1984-07-21', '', '', CPF_NUMBER, '', '', '', '+55 11 91234-5678', 'Rua das Flores 128', '01310-100', '1800.00', 'Branch visit.'],
  ['CLM-8803', 'Priyanka Rao', '1991-11-05', '', '', '', AADHAAR_NUMBER, '', '', '+91 98765 43210', '22 MG Road', '560001', '3200.00', 'Documents received.'],
  ['CLM-8804', 'Liam Fraser', '1979-02-18', '', '', '', '', SIN_NUMBER, TFN_NUMBER, '+1 (604) 555-0192', '900 Robson Street', 'V6Z 1A1', '2750.00', 'Verified by phone.'],
];

addFile('insurance-claims.csv', [
  ...claimRows.slice(1).flatMap((row) => [
    text(row[0]), text(row[1]), text(row[2]), text(row[4]), text(row[5]),
    text(row[6]), text(row[7]), text(row[8]), text(row[9]), text(row[10]),
    number(row[12]),
  ]),
  text(NI_NUMBER),
  text('M14 5TQ'), text('01310-100'), text('V6Z 1A1'), number('560001'),
  text('0161 496 0123'),
]);

// ----------------------------------------------------------------- HTML report
const htmlRows = [
  ['EMP-9001', 'Harriet Osei', 'harriet.osei@northwind.example', '+1 (312) 555-0148', '03/14/1985', '487-55-2130', '19 Willow Bend, Chicago, IL 60614', '$96,500.00'],
  ['EMP-9002', 'Mateo Rivera', 'mateo.rivera@northwind.example', '+1 (415) 555-0172', '11/02/1990', '612-44-8890', '845 Bay Street, San Francisco, CA 94109', '$112,000.00'],
  ['EMP-9003', 'Sofia Lindqvist', 'sofia.lindqvist@northwind.example', '+1 (206) 555-0133', '07/19/1982', '588-23-7741', '221 Pine Street, Seattle, WA 98101', '$104,500.00'],
];

const htmlDocument = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Employee Records — Q1</title>
  <style>td { padding: 2px 6px; }</style>
</head>
<body>
  <h1>Employee Records</h1>
  <table class="employees">
    <thead><tr><th>Employee ID</th><th>Full Name</th><th>Work Email</th><th>Phone</th><th>Date of Birth</th><th>SSN</th><th>Home Address</th><th>Salary</th></tr></thead>
    <tbody>
${htmlRows.map((row) => `      <tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n')}
    </tbody>
  </table>
  <h2>Emergency contact</h2>
  <table class="kv">
    <tr><th>Name</th><td>Yaa Osei</td></tr>
    <tr><th>Phone</th><td>(312) 555-0191</td></tr>
    <tr><th>Email</th><td>yaa.osei@example.org</td></tr>
  </table>
  <p>Questions: <a href="mailto:hr@northwind.example">hr@northwind.example</a> or (312) 555-0100.</p>
</body>
</html>
`;

addFile('hr-records.html', [
  ...htmlRows.flatMap((row) => [
    text(row[0]), text(row[1]), text(row[2]), text(row[3]), text(row[4]),
    text(row[5]), text(row[6]), number(row[7].replace(/[$,]/g, '')),
  ]),
  text('Yaa Osei'), text('(312) 555-0191'), text('yaa.osei@example.org'),
  text('hr@northwind.example'), text('(312) 555-0100'),
]);

// ------------------------------------------------------------- env / secrets
// Synthetic values that scanners recognise by shape (Stripe, Twilio, Slack).
// Build them from parts here so this source file does not contain a contiguous
// "secret"; the generated fixtures/ directory is excluded from scanning in
// .github/secret_scanning.yml. The fixture bytes are unchanged.
const FAKE_STRIPE_KEY = ['sk', 'live', '51H8xQ2LkdIwHu7ix7QwErTyUiOpAsDfGhJkL'].join('_');
const FAKE_TWILIO_KEY = ['SK', '0123456789abcdef0123456789abcdef'].join('');
const FAKE_SLACK_WEBHOOK = [
  'https://hooks.slack.com/services',
  'T00000000',
  'B00000000',
  'XXXXXXXXXXXXXXXXXXXXXXXX',
].join('/');

const envFile = [
  '# Production configuration',
  'APP_ENV=production',
  'DATABASE_URL=postgres://app_user:S3curePassw0rd!@db.internal.northwind.example:5432/orders',
  'REDIS_URL=redis://cache_user:R3disPass@cache.internal.northwind.example:6379/0',
  `STRIPE_SECRET_KEY=${FAKE_STRIPE_KEY}`,
  'GOOGLE_MAPS_API_KEY=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY',
  'SENDGRID_API_KEY=SG.ABCDEFGHIJKLMNOPQRSTUV.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn',
  `TWILIO_API_KEY=${FAKE_TWILIO_KEY}`,
  'NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123456789',
  `SLACK_WEBHOOK=${FAKE_SLACK_WEBHOOK}`,
  'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'ADMIN_EMAIL=ops.admin@northwind.example',
  'SUPPORT_PHONE=+44 20 7946 0958',
  'OFFICE_IP=2001:db8:85a3::8a2e:370:7334',
  'PRINTER_MAC=00:1B:44:11:3A:B7',
  'HQ_LAT=51.5074',
  'HQ_LNG=-0.1278',
  'SESSION_COOKIE=session=9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c; Path=/; HttpOnly; Secure; SameSite=Lax',
  'SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
  'QyNTUxOQAAACDk8n0T1r2P3s4V5w6X7y8Z9a0B1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R',
  '-----END OPENSSH PRIVATE KEY-----"',
  '',
].join('\n');

addFile('app-config.env', [
  text('postgres://app_user:S3curePassw0rd!@db.internal.northwind.example:5432/orders'),
  text('redis://cache_user:R3disPass@cache.internal.northwind.example:6379/0'),
  text(FAKE_STRIPE_KEY),
  text('AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY'),
  text('SG.ABCDEFGHIJKLMNOPQRSTUV.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'),
  text(FAKE_TWILIO_KEY),
  text('npm_abcdefghijklmnopqrstuvwxyz0123456789'),
  text(FAKE_SLACK_WEBHOOK),
  text('AKIAIOSFODNN7EXAMPLE'),
  text('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'),
  text('ops.admin@northwind.example'),
  text('+44 20 7946 0958'),
  text('2001:db8:85a3::8a2e:370:7334'),
  text('00:1B:44:11:3A:B7'),
  text('51.5074'),
  text('-0.1278'),
  text('session=9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c'),
  text('b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW'),
]);

// ------------------------------------------------------------- YAML profile
const yamlFile = [
  '# Customer profile — internal use only',
  'customer:',
  '  id: CUS-77341',
  '  full_name: Ingrid Halvorsen',
  '  email: ingrid.halvorsen@example.no',
  '  phone: "+47 22 12 34 56"',
  '  date_of_birth: 1977-09-08',
  '  national_id: "AB 12 34 56 C"',
  '  address:',
  '    line1: "12 Strandgata"',
  '    city: Bergen',
  '    postal_code: "5013"',
  '  vehicle_vin: 1HGCM82633A004352',
  '  crypto_wallet: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"',
  '  password: "Fjord!2024"',
  '  api_key: "sk-proj-4d8f2a6c9e1b7d3f5a0c8e2b6d4f1a9c"',
  '  last_login:',
  '    ip: 192.0.2.44',
  '    at: 2024-02-11T08:14:00Z',
  '  coordinates: "60.3913, 5.3221"',
  '',
].join('\n');

addFile('customer-profile.yaml', [
  text('CUS-77341'), text('Ingrid Halvorsen'), text('ingrid.halvorsen@example.no'),
  text('+47 22 12 34 56'), text('1977-09-08'), text('AB 12 34 56 C'),
  text('12 Strandgata'), text('Bergen'), number('5013'),
  text('1HGCM82633A004352'), text('0x71C7656EC7ab88b098defB751B7401B5f6d8976F'),
  text('Fjord!2024'), text('sk-proj-4d8f2a6c9e1b7d3f5a0c8e2b6d4f1a9c'),
  text('192.0.2.44'), text('60.3913, 5.3221'),
]);

// ------------------------------------------------- encoded email (QP + base64)
function qpEncode(text) {
  const bytes = Buffer.from(text.replace(/\r?\n/g, '\n'), 'utf8');
  let out = '';
  let line = 0;
  for (const byte of bytes) {
    if (byte === 0x0a) {
      out += '\r\n';
      line = 0;
      continue;
    }
    if (byte === 0x0d) continue;
    const token =
      byte === 9 || (byte >= 32 && byte <= 126 && byte !== 61)
        ? String.fromCharCode(byte)
        : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    if (line + token.length > 74) {
      out += '=\r\n';
      line = 0;
    }
    out += token;
    line += token.length;
  }
  return out;
}

function b64Lines(text) {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) || []).join('\r\n');
}

function encodedWord(text) {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

const emlName = 'Zoë Laurent';
const emlEmail = 'zoe.laurent@example.fr';
const emlPlain = [
  'Hi Owen,',
  '',
  'The statement for Zoë Laurent is attached. Call 020 7946 0958 or reply to',
  'zoe.laurent@example.fr. Date of birth on file: 1982-05-17.',
  '',
  'Thanks,',
  'Zoë Laurent',
  '',
].join('\r\n');
const emlHtml = `<html><body><p>Zoë Laurent — 020 7946 0958</p><p>${emlEmail}</p></body></html>`;
const emlAttachment = 'PDF-FAKE-STATEMENT-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3);
const encodedEml = [
  `From: ${encodedWord(emlName)} <${emlEmail}>`,
  'To: "Owen Pritchard" <owen.pritchard@example.co.uk>',
  'Subject: =?UTF-8?B?U3RhdGVtZW50IGZvciBab8OrIExhdXJlbnQ=?=',
  'Date: Mon, 12 Feb 2024 10:05:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="----=_Part_Encoded_1"',
  '',
  '------=_Part_Encoded_1',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  qpEncode(emlPlain),
  '------=_Part_Encoded_1',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: base64',
  '',
  b64Lines(emlHtml),
  '------=_Part_Encoded_1',
  'Content-Type: application/pdf; name="Zoë Laurent - statement.pdf"',
  'Content-Disposition: attachment; filename="Zoë Laurent - statement.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  b64Lines(emlAttachment),
  '------=_Part_Encoded_1--',
  '',
].join('\r\n');

addFile('mail-encoded.eml', [
  text(emlName), text(emlEmail), text('020 7946 0958'), text('1982-05-17'),
  text('Owen Pritchard'), text('owen.pritchard@example.co.uk'),
  text('Zoë Laurent - statement.pdf'),
]);

// -------------------------------------------------------- XML/SOAP CRM export
// The field name lives in the tag (or the attribute), so a bare "Aisha" is
// typed exactly as it would be from a CSV header.
const xmlExport = `<?xml version="1.0" encoding="UTF-8"?>
<crm:CustomerExport xmlns:crm="urn:example:crm" exportedAt="2024-02-12T09:00:00Z">
  <crm:Customer id="CUS-88213">
    <crm:FirstName>Aisha</crm:FirstName>
    <crm:LastName>Rahman</crm:LastName>
    <crm:Email>aisha.rahman@northwind.example</crm:Email>
    <crm:Phone>+44 20 7946 0958</crm:Phone>
    <crm:DateOfBirth>1991-04-17</crm:DateOfBirth>
    <crm:Address line1="18 Marsh Lane" city="Manchester" postcode="M14 5TQ" country="GB"/>
    <crm:AccountNumber>004211889301</crm:AccountNumber>
    <crm:Balance currency="GBP">2450.00</crm:Balance>
    <crm:Owner>Priya Natarajan</crm:Owner>
  </crm:Customer>
  <crm:Customer id="CUS-88214">
    <crm:FirstName>Diego</crm:FirstName>
    <crm:LastName>Marques</crm:LastName>
    <crm:Contact email="d.marques@contoso.example" phone="+91 98765 43210"/>
    <crm:Address line1="Rua das Flores 128" city="São Paulo" postcode="01310-100" country="BR"/>
  </crm:Customer>
  <crm:Customer id="CUS-88215">
    <crm:FirstName>Siobhán</crm:FirstName>
    <crm:LastName>O'Brien</crm:LastName>
    <crm:Email>siobhan.obrien@example.ie</crm:Email>
    <crm:Address line1="12 Quay Street" city="Cork" postcode="T12 X8Y2" country="IE"/>
  </crm:Customer>
</crm:CustomerExport>
`;

addFile('crm-export.xml', [
  text('Aisha'), text('Rahman'), text('Priya Natarajan'), text('Diego'), text('Marques'),
  text("O'Brien"), text('Siobhán'),
  text('aisha.rahman@northwind.example'), text('d.marques@contoso.example'), text('siobhan.obrien@example.ie'),
  text('+44 20 7946 0958'), text('+91 98765 43210'), text('1991-04-17'),
  text('18 Marsh Lane'), text('Manchester'), text('M14 5TQ'),
  text('Rua das Flores 128'), text('São Paulo'), text('01310-100'),
  text('12 Quay Street'), text('Cork'), text('T12 X8Y2'), text('004211889301'), text('2450.00'),
]);

// ------------------------------------------------------------------ SQL dump
// mysqldump writes `INSERT INTO t VALUES (…)` with no column list; the column
// names only exist in the CREATE TABLE above it. Quoted apostrophes (`O''Brien`)
// must both match and be re-escaped on the way back in.
const sqlDump = `-- MySQL dump 10.13  Distrib 8.0.35, for Linux (x86_64)
--
-- Host: db-prod.internal    Database: crm
-- ------------------------------------------------------
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;

DROP TABLE IF EXISTS \`customers\`;
CREATE TABLE \`customers\` (
  \`customer_id\` int NOT NULL AUTO_INCREMENT,
  \`first_name\` varchar(40) DEFAULT NULL,
  \`last_name\` varchar(40) DEFAULT NULL,
  \`email\` varchar(80) DEFAULT NULL,
  \`phone\` varchar(30) DEFAULT NULL,
  \`ssn\` varchar(11) DEFAULT NULL,
  \`birth_date\` date DEFAULT NULL,
  \`street\` varchar(80) DEFAULT NULL,
  \`zip\` varchar(12) DEFAULT NULL,
  \`annual_salary\` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (\`customer_id\`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;

LOCK TABLES \`customers\` WRITE;
INSERT INTO \`customers\` VALUES (1,'Jane','Doe','jane.doe@acme.example','(415) 555-0138','123-45-6789','1986-04-17','742 Evergreen Terrace','94110',92500.00),(2,'Seán','O''Brien','sean.obrien@example.ie','+353 1 234 5678','987-65-4321','1979-11-02','12 Quay Street','D02 X285',74000.00),(3,'Amara','Okafor','amara.okafor@contoso.example','+1 (604) 555-0192','555-44-3322','1992-08-09','900 Robson Street','V6Z 1A1',68000.00);
UNLOCK TABLES;
`;

addFile('customers-dump.sql', [
  text('Jane'), text('Doe'), text('Seán'), text("O'Brien"), text('Amara'), text('Okafor'),
  text('jane.doe@acme.example'), text('sean.obrien@example.ie'), text('amara.okafor@contoso.example'),
  text('(415) 555-0138'), text('+353 1 234 5678'), text('+1 (604) 555-0192'),
  text('123-45-6789'), text('987-65-4321'), text('555-44-3322'),
  text('1986-04-17'), text('1979-11-02'), text('1992-08-09'),
  text('742 Evergreen Terrace'), text('12 Quay Street'), text('900 Robson Street'),
  text('94110'), text('D02 X285'), text('V6Z 1A1'),
  text('92500.00'), text('74000.00'), text('68000.00'),
]);

// -------------------------------------------------------- passport MRZ (text)
// A scanned passport's text layer. The two 44-character lines carry their own
// check digits, which is a near-perfect signature for the format.
const mrzLine1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const mrzLine2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
const passportText = `KYC dossier — passport capture
Applicant: Anna Maria Eriksson
Date of birth: 1974-08-12
Nationality: UTO
Passport number: L898902C3
Machine-readable zone:
${mrzLine1}
${mrzLine2}
Verified against the original document on 2024-02-12.
`;

addFile('passport-mrz.txt', [
  text('Anna Maria Eriksson'), text('L898902C3'), text('1974-08-12'),
  text(mrzLine1), text(mrzLine2),
]);

// ------------------------------------------------------- LDAP directory (LDIF)
const ldif = `dn: cn=Jane Doe,ou=People,dc=example,dc=com
objectClass: inetOrgPerson
cn: Jane Doe
sn: Doe
givenName: Jane
mail: jane.doe@example.com
telephoneNumber: +1 415 555 0138
uid: jdoe
employeeNumber: EMP-88213
homePostalAddress: 742 Evergreen Terrace, Springfield, IL 62704
userPassword: {SSHA}5en6G6MezRroT3XKqkdPOmY/BfQ=

dn: cn=Robert Chen,ou=People,dc=example,dc=com
objectClass: inetOrgPerson
cn: Robert Chen
sn: Chen
givenName: Robert
mail: robert.chen@example.com
telephoneNumber: +1 206 555 0177
uid: rchen
employeeNumber: EMP-88214
homePostalAddress: 90 Pike Street, Seattle, WA 98101
userPassword: {SSHA}Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA==
`;

addFile('directory-export.ldif', [
  text('Jane Doe'), text('jane.doe@example.com'), text('+1 415 555 0138'),
  text('EMP-88213'), text('742 Evergreen Terrace, Springfield, IL 62704'),
  text('{SSHA}5en6G6MezRroT3XKqkdPOmY/BfQ='),
  text('Robert Chen'), text('robert.chen@example.com'), text('+1 206 555 0177'),
  text('EMP-88214'), text('90 Pike Street, Seattle, WA 98101'),
  text('{SSHA}Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA=='),
]);

// --------------------------------------------------------------------- write
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'bank-transactions.csv'), csv(bankRows));
await fs.writeFile(path.join(OUT, 'accounts-receivable.xlsx'), workbookBuffer());
await fs.writeFile(path.join(OUT, 'user-export.json'), JSON.stringify({ export_version: 2, generated_at: '2024-02-01T09:15:00Z', users }, null, 2) + '\n');
await fs.writeFile(path.join(OUT, 'kyc-profile.docx'), await docxBuffer());
await fs.writeFile(path.join(OUT, 'board-deck.pptx'), await pptxBuffer());
await fs.writeFile(path.join(OUT, 'statement.pdf'), pdfBuffer(pdfLines));
await fs.writeFile(path.join(OUT, 'support-tickets.csv'), csv(supportRows));
await fs.writeFile(
  path.join(OUT, 'payroll-register.tsv'),
  payrollRows.map((row) => row.join('\t')).join('\n') + '\n',
);
await fs.writeFile(path.join(OUT, 'crm-events.jsonl'), crmLines.map((line) => JSON.stringify(line)).join('\n') + '\n');
await fs.writeFile(path.join(OUT, 'support-thread.eml'), eml);
await fs.writeFile(path.join(OUT, 'contacts.vcf'), vcf);
await fs.writeFile(path.join(OUT, 'team-calendar.ics'), ics);
await fs.writeFile(path.join(OUT, 'patient-notes.md'), markdown);
await fs.writeFile(path.join(OUT, 'access.log'), accessLog);
await fs.writeFile(path.join(OUT, 'insurance-claims.csv'), csv(claimRows));
await fs.writeFile(path.join(OUT, 'hr-records.html'), htmlDocument);
await fs.writeFile(path.join(OUT, 'app-config.env'), envFile);
await fs.writeFile(path.join(OUT, 'customer-profile.yaml'), yamlFile);
await fs.writeFile(path.join(OUT, 'mail-encoded.eml'), encodedEml);
await fs.writeFile(path.join(OUT, 'crm-export.xml'), xmlExport);
await fs.writeFile(path.join(OUT, 'customers-dump.sql'), sqlDump);
await fs.writeFile(path.join(OUT, 'passport-mrz.txt'), passportText);
await fs.writeFile(path.join(OUT, 'directory-export.ldif'), ldif);
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const file of manifest.files) {
  console.log(`${file.name}: ${file.secrets.length} secret(s)`);
}
console.log(`Wrote ${manifest.files.length} fixture files to fixtures/.`);
