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
  return zip.generateAsync({ type: 'nodebuffer' });
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
  '01/05 POS PURCHASE WHOLE FOODS #1042 -$128.45 Balance $3,971.55',
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
  text('Jane Doe'), text('1111'), text('(206) 555-0177'), text('jane.doe@example.com'),
  text('123-45-6789'), text('553100287'), text('88 Cedar Hollow Lane, Portland, OR 97205'),
  text('Winter2024!'), text('Marcus Webb'), text('marcus.webb@example.com'),
  text('742 Evergreen Terrace, Springfield, IL 62704'),
  text('sk-proj-9f3a2b7c4d8e1f6a0b5c9d2e7f4a1b8c'), text('198.51.100.17'),
  text('Robert Chen'), text('627-44-9018'), text('08/23/1992'), text('NL91ABNA0417164300'),
  text('Dana Whitfield'), text('Luis Ortega'),
]);

// --------------------------------------------------------------------- write
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'bank-transactions.csv'), csv(bankRows));
await fs.writeFile(path.join(OUT, 'accounts-receivable.xlsx'), workbookBuffer());
await fs.writeFile(path.join(OUT, 'user-export.json'), JSON.stringify({ export_version: 2, generated_at: '2024-02-01T09:15:00Z', users }, null, 2) + '\n');
await fs.writeFile(path.join(OUT, 'kyc-profile.docx'), await docxBuffer());
await fs.writeFile(path.join(OUT, 'statement.pdf'), pdfBuffer(pdfLines));
await fs.writeFile(path.join(OUT, 'support-tickets.csv'), csv(supportRows));
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const file of manifest.files) {
  console.log(`${file.name}: ${file.secrets.length} secret(s)`);
}
console.log(`Wrote ${manifest.files.length} fixture files to fixtures/.`);
