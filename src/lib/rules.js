// Standard regex detectors + custom keyword matching.

import { parseAmount } from './jiggle.js';
import { abaValid, einValid, ibanValid } from './identifiers.js';

const CURRENCY_CODES = 'USD|EUR|GBP|JPY|CAD|AUD|CHF|INR|MXN|BRL';
const MONTH_PATTERN =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const NAME_PATTERN = "[\\p{L}][\\p{L}'’.-]+(?:\\s+(?:[\\p{L}][\\p{L}'’.-]+|&)){1,3}";

export function digitCount(value) {
  return (String(value).match(/\d/g) || []).length;
}

/** Standard Luhn checksum used to avoid flagging arbitrary long numbers. */
export function luhnValid(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Standard rule catalogue. Lower `priority` wins when ranges overlap, so an
 * email is never also reported as a phone number.
 */
export const RULE_DEFS = {
  email: {
    id: 'email',
    label: 'Email addresses',
    hint: 'user@example.com',
    priority: 1,
    caseInsensitive: false,
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
  ssn: {
    id: 'ssn',
    label: 'US Social Security numbers',
    hint: '123-45-6789',
    priority: 2,
    caseInsensitive: false,
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  taxId: {
    id: 'taxId',
    label: 'Tax IDs (EIN)',
    hint: '91-2837465 (EIN checked)',
    priority: 2,
    caseInsensitive: false,
    pattern: /\b\d{2}-\d{7}\b/g,
    validate: einValid,
  },
  iban: {
    id: 'iban',
    label: 'IBAN bank accounts',
    hint: 'GB82 WEST 1234 5698 7654 32 (MOD-97 checked)',
    priority: 2,
    caseInsensitive: false,
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
    validate: ibanValid,
  },
  routing: {
    id: 'routing',
    label: 'Bank routing numbers (ABA)',
    hint: '021000021 (checksum checked)',
    priority: 2,
    caseInsensitive: false,
    pattern: /\b\d{9}\b/g,
    validate: abaValid,
  },
  creditCard: {
    id: 'creditCard',
    label: 'Credit card numbers',
    hint: '4111 1111 1111 1111 (Luhn checked)',
    priority: 3,
    caseInsensitive: false,
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: luhnValid,
  },
  creditCardPartial: {
    id: 'creditCardPartial',
    label: 'Card fragments (masked / last four)',
    hint: '**** **** **** 1234, ending in 1234',
    priority: 4,
    caseInsensitive: false,
    patterns: [
      // **** **** **** 1234, xxxx-xxxx-xxxx-1234, ••••••••••••1234
      /[*xX•·]{4}(?:[\s-]?[*xX•·]{4}){2}[\s-]?\d{4}(?!\d)/g,
      // "ending in 1234" / "ends with 1234"
      /\b(?:ending|ends)\s+(?:in|with)\s+\d{4}(?!\d)/gi,
      // "last four digits: 1234"
      /\blast\s+(?:four|4)\s+(?:digits|numbers?)(?:\s*(?:are|is|:|=|#|-))?\s*\d{4}(?!\d)/gi,
    ],
  },
  ssnPartial: {
    id: 'ssnPartial',
    label: 'SSN fragments (masked / last four)',
    hint: '***-**-6789, SSN ending in 6789',
    priority: 4,
    caseInsensitive: true,
    patterns: [
      /\b(?:\*{3}|X{3})[- ](?:\*{2}|X{2})[- ]\d{4}(?!\d)/gi,
      /(?<=(?:ssn|social security)(?:\s*(?:number|no\.?|#))?\s*(?:ending|ends)\s+(?:in|with)\s*)\d{4}(?!\d)/gi,
      /(?<=last\s+(?:four|4)\s+(?:digits|numbers?)\s+of\s+(?:the\s+)?(?:ssn|social security)(?:\s*(?:number|no\.?|#))?(?:\s*(?:are|is|:|=|-))?\s*)\d{4}(?!\d)/gi,
      /(?<=(?:ssn|social security)(?:\s*(?:number|no\.?|#))?\s*(?:last|final)\s+(?:four|4)(?:\s+(?:digits|numbers?))?\s*[:#=-]?\s*)\d{4}(?!\d)/gi,
    ],
  },
  labeledAccount: {
    id: 'account',
    label: 'Bank account numbers',
    hint: 'Account Number: 884201553, acct #1234-5678',
    priority: 2,
    caseInsensitive: true,
    pattern:
      /(?<=(?:account|acct|a\/c)\s*(?:number|no\.?|num|#)?\s*(?:is|are)?\s*[:#=-]?\s*)\d[\d\s-]{4,19}\d/g,
    validate: (value) => {
      const digits = String(value).replace(/\D/g, '').length;
      return digits >= 6 && digits <= 17;
    },
  },
  labelOrganization: {
    id: 'organization',
    label: 'Company and employer names',
    hint: 'Employer: Northwind Traders',
    priority: 2,
    caseInsensitive: true,
    pattern:
      /(?<=(?:employer|company|organization|organisation|vendor|supplier|contractor|agency|firm|business|facility|clinic|hospital|laboratory|practice)\s*(?:name\s*)?[:#=-]\s*)[\p{L}][\p{L}0-9&'’.,-]*(?:\s+[\p{L}0-9&'’.,-]+){0,5}/giu,
  },
  labeledName: {
    id: 'name',
    label: 'Names after a label or table header',
    hint: 'Customer: Jane Doe, beneficiary tables',
    priority: 2,
    caseInsensitive: false,
    patterns: [
      new RegExp(
        '(?<=(?:full name|name|customer|payee|employee|beneficiary|account holder|cardholder|applicant|contact|spouse|counterparty|transfer(?:red)? to|transfer(?:red)? from|paid to|received from|payroll|merchant|purchase(?: at)?|patient|insured|member|tenant|landlord|physician|provider|guardian|parent|witness|signatory|sender|recipient|attendee|organizer|author|seller|buyer|prepared by|approved by)\\s*[:#=-]?\\s*)(?:(?:Dr|Mr|Ms|Mrs|Prof|Rev)\\.?\\s+)?' +
          NAME_PATTERN +
          '(?:,?\\s+(?:Jr|Sr|II|III|IV)\\.?)?',
        'gu',
      ),
      // CRM/HR "Name: Doe, Jane" form.
      new RegExp(
        '(?<=(?:full name|name|customer|payee|employee|beneficiary|contact|patient|insured|tenant|landlord|witness|signatory)\\s*[:#=-]\\s*)[\\p{L}][\\p{L}’\'.-]*,\\s*[\\p{L}][\\p{L}’\'.-]*(?:\\s+[\\p{L}][\\p{L}’\'.-]*){0,2}',
        'gu',
      ),
    ],
  },
  headerName: {
    id: 'name',
    label: 'Email header display names',
    hint: 'From: Camille Dubois <camille@example.org>',
    priority: 2,
    caseInsensitive: true,
    pattern: new RegExp(
      '(?<=^(?:From|To|Cc|Bcc|Reply-To|Sender):\\s*)(?:(?:Dr|Mr|Ms|Mrs|Prof)\\.?\\s+)?' + NAME_PATTERN,
      'gmu',
    ),
  },
  signatureName: {
    id: 'name',
    label: 'Names in email signatures',
    hint: 'Thanks,\nCamille Dubois',
    priority: 2,
    caseInsensitive: true,
    pattern: new RegExp(
      '(?<=^(?:Thanks|Thank you|Best|Best regards|Regards|Sincerely|Cheers|Kind regards),?[ \\t]*\\r?\\n)(?:(?:Dr|Mr|Ms|Mrs|Prof)\\.?\\s+)?' + NAME_PATTERN,
      'gmu',
    ),
  },
  labeledPhone: {
    id: 'phone',
    label: 'Phone numbers after a label',
    hint: 'Phone: 4155550138',
    priority: 6,
    caseInsensitive: true,
    pattern:
      /(?<=(?:phone|mobile|cell|tel|telephone|call|text|reach|contact|dial|fax)(?:\s+(?:me|us))?(?:\s+at)?(?:\s*(?:number|no\.?|#))?\s*[:#=-]?\s*)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/gi,
  },
  phoneIntl: {
    id: 'phone',
    label: 'International phone numbers',
    hint: '+33 6 12 34 56 78',
    priority: 6,
    caseInsensitive: false,
    pattern: /(?<![\w+])\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?(?:\d[\s.-]?){6,12}\d(?!\d)/g,
    validate: (v) => digitCount(v) >= 8 && digitCount(v) <= 15,
  },
  medicalId: {
    id: 'medicalId',
    label: 'Medical & insurance IDs',
    hint: 'MRN: 88213, Member ID: HP-99281-04, NPI: 1234567890',
    priority: 3,
    caseInsensitive: true,
    pattern:
      /(?<=(?:mrn|medical record(?:\s*(?:number|no\.?|#))?|patient id|member id|member no\.?|group(?:\s*(?:number|no\.?|#|id|code))?|policy(?:\s*(?:number|no\.?|#|id))?|claim(?:\s*(?:number|no\.?|#|id))?|npi|dea)(?:\s*(?:number|no\.?|#))?\s*[:#=]\s*)[A-Z0-9][A-Z0-9-]{4,24}\b/gi,
  },
  profileUrl: {
    id: 'profileUrl',
    label: 'Profile URLs and @handles',
    hint: 'linkedin.com/in/janedoe, @janedoe',
    priority: 3,
    caseInsensitive: true,
    patterns: [
      /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com|twitter\.com|x\.com)\/[A-Za-z0-9._%-]+/gi,
      /(?<![\w@])@[A-Za-z0-9_.]{3,30}\b/g,
    ],
  },
  swiftBic: {
    id: 'swiftBic',
    label: 'SWIFT / BIC codes',
    hint: 'SWIFT: NWBKGB2L',
    priority: 3,
    caseInsensitive: true,
    pattern:
      /(?<=(?:swift|bic)(?:\s*(?:code|number|no\.?))?\s*[:#=-]\s*)[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi,
  },
  labeledDob: {
    id: 'dob',
    label: 'Dates of birth',
    hint: 'DOB: 04/17/1986, born 1986-04-17, April 17, 1986',
    priority: 2,
    caseInsensitive: true,
    pattern: new RegExp(
      '(?<=(?:dob|d\\.o\\.b\\.?|date of birth|birth date|born)\\s*(?:is|was)?\\s*[:#=-]?\\s*)(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}|(?:' +
        MONTH_PATTERN +
        ')\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:' +
        MONTH_PATTERN +
        ')\\.?,?\\s+\\d{4})',
      'gi',
    ),
  },
  passport: {
    id: 'passport',
    label: 'Passport numbers',
    hint: 'Passport No: 512345678',
    priority: 2,
    caseInsensitive: true,
    pattern: /(?<=passport(?:\s*(?:number|no\.?|#))?\s*[:#=-]\s*)[A-Z0-9]{8,9}\b/g,
  },
  license: {
    id: 'license',
    label: "Driver's license numbers",
    hint: 'DL: WDL-8842193',
    priority: 2,
    caseInsensitive: true,
    pattern:
      /(?<=(?:driver'?s?\s+licen[cs]e(?:\s*(?:number|no\.?|#))?|\bdl)\s*[:#=-]\s*)[A-Z0-9-]{6,16}\b/g,
  },
  ipAddress: {
    id: 'ipAddress',
    label: 'IP addresses',
    hint: '203.0.113.42',
    priority: 2,
    caseInsensitive: false,
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    validate: (value) => value.split('.').every((octet) => Number(octet) <= 255),
  },
  password: {
    id: 'password',
    label: 'Passwords',
    hint: 'Password: Winter2024!',
    priority: 2,
    caseInsensitive: true,
    pattern: /(?<=(?:password|passwd|pwd)\s*[:=]\s*)[^\s,;]{6,}/g,
  },
  apiKey: {
    id: 'apiKey',
    label: 'API keys and tokens',
    hint: 'sk-proj-…, AKIA…, ghp_…, xoxb-…, JWTs, Bearer tokens',
    priority: 2,
    caseInsensitive: false,
    patterns: [
      /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
      /\bAKIA[0-9A-Z]{16}\b/g,
      /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
      /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      /(?<=(?:Authorization:\s*)?Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/g,
      /(?<=x-api-key:\s*)[A-Za-z0-9._-]{16,}/gi,
      /(?<=[?&](?:access_token|api_key|token|key)=)[A-Za-z0-9._~%-]{16,}/gi,
    ],
  },
  address: {
    id: 'address',
    label: 'Street addresses',
    hint: '742 Evergreen Terrace, Springfield, IL 62704',
    priority: 3,
    caseInsensitive: false,
    patterns: [
      /\b\d{1,5}\s+(?:[A-Z][A-Za-z'.-]+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Circle|Cir)\b(?:,?\s*(?:Apt|Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?(?:,\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?/g,
      // PO boxes appear in bank/KYC exports without a street number.
      /\bP\.?\s?O\.?\s+Box\s+\d+\b(?:,\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/gi,
    ],
  },
  labeledRecordId: {
    id: 'recordId',
    label: 'Account / user / transaction IDs',
    hint: 'User ID: USR-88213, Transaction #TXN-88214',
    priority: 3,
    caseInsensitive: true,
    pattern:
      /(?<=(?:transaction|txn|reference|ref|confirmation|ticket|user|customer|member|employee|client|contact|policy)\s*(?:id|no\.?|number|#)?\s*[:#]\s*)[A-Z]{1,6}[-_]?\d{3,12}\b/g,
  },
  amount: {
    id: 'amount',
    label: 'Monetary amounts (±20% jiggle)',
    hint: '$1,234.56, USD 2,000, 5,000.00, 1200.75 — format kept',
    priority: 5,
    caseInsensitive: false,
    patterns: [
      // Symbol amounts: $1,234.56, -$1,200.00, ($1,234.56)
      /(?<![\w$€£¥₹])[-+]?\(?[$€£¥₹][ \t]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?(?!\d)(?!\.\d)(?!,\d)/g,
      // Currency-code amounts: USD 1,234.56, eur 2,000
      new RegExp(
        `\\b(?:${CURRENCY_CODES})[ \\t]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?(?!\\d)(?!\\.\\d)(?!,\\d)(?![ \\t]*%)`,
        'gi',
      ),
      // Bare grouped decimals: 1,234.56 (financial tables, exports)
      /(?<![\w.,])\(?[-+]?\d{1,3}(?:,\d{3})+\.\d{2}(?!\d)(?!\s*%)/g,
      // Bare decimals with 3+ integer digits: 1200.75. The digit floor keeps
      // dates (2024.01.15) and version-like numbers (1.20) out of the results.
      /(?<![\w.,])\(?[-+]?\d{3,}\.\d{2}(?!\d)(?!\.\d)(?!\s*%)/g,
    ],
    // Zero has no meaningful percentage to shift, and it leaks nothing.
    validate: (value) => {
      const parsed = parseAmount(value);
      return Boolean(parsed) && parsed.value !== 0;
    },
  },
  phone: {
    id: 'phone',
    label: 'Phone numbers (US)',
    hint: '(555) 123-4567, 555-123-4567, +1 555 123 4567',
    priority: 6,
    caseInsensitive: false,
    // Deliberately stricter than a bare \d{10}: a separator (or parentheses)
    // must be present, so transaction/account numbers are not mistaken for
    // phone numbers. Lookarounds keep matches out of longer digit runs.
    pattern:
      /(?<!\w)(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]?\d{4}(?!\w)/g,
    validate: (v) => digitCount(v) >= 10 && digitCount(v) <= 11,
  },
};

export const DEFAULT_CONFIG = {
  rules: {
    email: true,
    phone: true,
    ssn: true,
    taxId: true,
    iban: true,
    routing: true,
    creditCard: true,
    creditCardPartial: true,
    ssnPartial: true,
    account: true,
    name: true,
    dob: true,
    passport: true,
    license: true,
    ipAddress: true,
    password: true,
    apiKey: true,
    address: true,
    recordId: true,
    medicalId: true,
    profileUrl: true,
    swiftBic: true,
    amount: true,
  },
  customKeywords: [],
};

function isTaken(used, start, end) {
  for (let i = start; i < end; i += 1) {
    if (used[i]) return true;
  }
  return false;
}

function markUsed(used, start, end) {
  for (let i = start; i < end; i += 1) used[i] = true;
}

/** Custom keywords are matched case-insensitively so every casing is redacted. */
function detectKeywords(text, keywords, used, out) {
  for (const raw of keywords || []) {
    const keyword = String(raw).trim();
    if (keyword.length < 2) continue;
    const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (isTaken(used, start, end)) {
        re.lastIndex = end; // still advance past overlaps
        continue;
      }
      markUsed(used, start, end);
      out.push({ type: 'custom', value: text.slice(start, end), start, end });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

/**
 * Find every PII/secret match in a string of text.
 * @returns {Array<{type:string,value:string,start:number,end:number}>}
 */
export function detectInText(text, config = DEFAULT_CONFIG) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const { rules = {}, customKeywords = [] } = config || {};
  const used = new Array(text.length).fill(false);
  const out = [];

  detectKeywords(text, customKeywords, used, out);

  const active = Object.values(RULE_DEFS)
    .filter((def) => rules[def.id])
    .sort((a, b) => a.priority - b.priority);

  for (const def of active) {
    for (const pattern of def.patterns || [def.pattern]) {
      // Several rules are labelled lookbehinds: the label may be typed in any
      // casing ("Date of birth", "DATE OF BIRTH"), the value is what matters.
      const flags =
        def.caseInsensitive && !pattern.flags.includes('i') ? `${pattern.flags}i` : pattern.flags;
      const re = new RegExp(pattern.source, flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (end === start) {
          re.lastIndex += 1;
          continue;
        }
        if (def.validate && !def.validate(m[0])) continue;
        if (isTaken(used, start, end)) continue;
        markUsed(used, start, end);
        out.push({ type: def.id, value: text.slice(start, end), start, end });
      }
    }
  }

  return out.sort((a, b) => a.start - b.start);
}
