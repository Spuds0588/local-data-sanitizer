// Context-aware classification: a spreadsheet header or a JSON key says what a
// value *is*, which is exactly what bare identifiers lack. A 9-digit account
// number, a whole-dollar balance and a customer name are all invisible to pure
// text regexes; "account number", "balance" and "full name" are not.

import { parseAmount } from './jiggle.js';
import { luhnValid } from './rules.js';
import {
  abaValid,
  einValid,
  ibanValid,
  ipv6Valid,
  nationalIdScheme,
  normalizeIban,
} from './identifiers.js';

const MONEY_WORDS = new Set([
  'amount', 'balance', 'subtotal', 'total', 'price', 'cost', 'debit', 'credit',
  'salary', 'wage', 'fee', 'tax', 'payment', 'deposit', 'withdrawal', 'net',
  'gross', 'due', 'paid', 'refund', 'rent', 'income', 'revenue', 'charge',
]);

const NAME_WORDS = new Set([
  'name', 'payee', 'customer', 'employee', 'beneficiary', 'cardholder',
  'applicant', 'contact', 'spouse', 'holder', 'landlord', 'tenant',
  'agent', 'assignee', 'representative', 'patient', 'insured', 'member',
  'physician', 'provider', 'guardian', 'parent', 'witness', 'signatory',
  'sender', 'recipient', 'attendee', 'organizer', 'author', 'buyer', 'seller',
  'owner', 'assignee', 'manager', 'director', 'officer',
]);

// These headers name an organisation, not a person. Replacing "Northwind
// Traders" with a person's name makes a payroll or CRM export read wrong.
const ORG_WORDS = new Set([
  'company', 'employer', 'organization', 'organisation', 'org', 'vendor',
  'supplier', 'contractor', 'firm', 'agency', 'business', 'facility',
  'clinic', 'hospital', 'laboratory', 'practice', 'payer', 'insurer',
  'carrier', 'broker', 'landlord', 'university', 'school',
]);

const NAME_STOPWORDS = new Set([
  'n/a', 'na', 'none', 'null', 'unknown', 'test', 'admin', 'system', 'user',
  'customer', 'guest', 'tbd', 'name', 'true', 'false', 'deleted',
]);

const ID_OWNERS = new Set([
  'user', 'customer', 'member', 'employee', 'client', 'account', 'transaction',
  'txn', 'reference', 'ref', 'confirmation', 'ticket', 'record', 'patient',
  'student', 'policy', 'order', 'contact', 'lead', 'vendor', 'candidate',
  'subscriber', 'household', 'device', 'session', 'event', 'case',
]);

const CONNECTORS = new Set(['&', 'of', 'the', 'and', 'for']);

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?\d{0,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Split a key/header into lowercase words, including camelCase boundaries. */
export function keyWords(key) {
  return String(key ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

/**
 * Map a header/key to a sensitive-data type. Returns null for anything that
 * carries no context ("Description", "Invoice #").
 */
export function classifyHeader(header) {
  const words = keyWords(header);
  if (words.length === 0) return null;
  const has = (word) => words.includes(word);
  const joined = words.join('');
  const hasId = has('id') || has('number') || has('no') || has('num') || has('code');

  if (has('email') || has('mail')) return 'email';
  if (has('phone') || has('mobile') || has('tel') || has('telephone') || has('cell') || has('fax')) return 'phone';
  if (joined.includes('ssn') || joined.includes('socialsecurity')) {
    return has('last') || has('four') || has('partial') || joined.includes('ssn4') ? 'ssnPartial' : 'ssn';
  }
  if (has('dob') || (has('birth') && has('date')) || joined === 'birthdate' || has('born')) return 'dob';
  if (has('iban')) return 'iban';
  if (has('routing') || has('aba') || has('rtn')) return 'routing';
  if (has('swift') || has('bic')) return 'swiftBic';

  // Health-plan identifiers first: "Member ID" and "Claim Number" are medical
  // IDs, not generic record keys.
  if (
    has('mrn') ||
    joined.includes('medicalrecord') ||
    (has('medical') && hasId) ||
    (has('member') && hasId) ||
    (has('group') && hasId) ||
    (has('policy') && hasId) ||
    (has('claim') && hasId) ||
    has('npi') ||
    has('dea')
  ) {
    return 'medicalId';
  }

  // "Account Holder" is a person; "Account Number"/"Account" is the number.
  if (has('account') || has('acct')) {
    if (has('holder')) return 'name';
    if (has('id') && !has('number') && !has('no') && !has('num')) return 'recordId';
    // "Bank Account" / "Checking Account" name the number; "Account Manager"
    // does not.
    if (hasId || words.length === 1 || has('bank') || has('checking') || has('savings')) return 'account';
  }
  if (has('card') || has('cc') || has('pan')) {
    return has('last') || has('four') || joined.includes('last4') ? 'creditCardPartial' : 'card';
  }
  if ((has('tax') && has('id')) || has('ein') || has('tin')) return 'taxId';
  if (has('passport')) return 'passport';
  if (has('license') || has('licence') || has('dl')) return 'license';
  if (
    has('aadhaar') ||
    has('aadhar') ||
    has('cpf') ||
    has('nhs') ||
    has('pesel') ||
    has('bsn') ||
    has('nino') ||
    (has('national') && (hasId || has('insurance'))) ||
    (has('ni') && (has('number') || has('no'))) ||
    has('sin') ||
    has('tfn') ||
    (has('social') && has('insurance'))
  ) {
    return 'nationalId';
  }
  if (has('vin') || has('chassis')) return 'vin';
  if (has('authorization')) return 'apiKey';
  if (
    has('lat') ||
    has('latitude') ||
    has('lng') ||
    has('lon') ||
    has('longitude') ||
    has('geo') ||
    has('coordinate')
  ) {
    return 'coordinates';
  }
  if (has('ip') || joined === 'ipaddress') return 'ipAddress';
  if (has('password') || has('passwd') || has('pwd')) return 'password';
  if (has('cookie')) return 'cookie';
  if (has('crypto') || has('wallet')) return 'cryptoWallet';
  if (
    has('apikey') ||
    has('secret') ||
    has('token') ||
    has('credential') ||
    (has('access') && has('key')) ||
    (has('key') && (has('private') || has('ssh') || has('signing') || has('encryption')))
  ) {
    return 'apiKey';
  }
  if (has('address') || has('street') || has('line1') || has('line2') || has('residence') || has('mailing')) {
    return 'address';
  }
  if (has('city') || has('town')) return 'city';
  // A two-letter state is too short to replace safely as free text; it stays.
  if (has('postal') || has('zip') || has('postcode')) return 'postalCode';
  // IDs before names: "Customer ID" is not a customer name. A bare `id` key is
  // the commonest identifier in a JSON API / event stream.
  if (has('id') && (words.length === 1 || ID_OWNERS.has(words[0]))) return 'recordId';
  if (ID_OWNERS.has(joined) && ['reference', 'ref', 'ticket', 'transaction', 'txn', 'confirmation'].some((w) => joined.includes(w))) {
    return 'recordId';
  }
  // "Vendor Contact" is a person even though "Vendor" alone is a company.
  if (has('contact')) return 'name';
  // A profile URL/handle carries a real person's name in its path.
  if (
    !has('name') &&
    (has('linkedin') || has('github') || has('twitter') || has('handle') || has('username') || has('profile'))
  ) {
    return 'profileUrl';
  }
  if (words.some((word) => ORG_WORDS.has(word))) return 'organization';
  if (words.some((word) => NAME_WORDS.has(word))) return 'name';
  if (words.some((word) => MONEY_WORDS.has(word))) return 'amount';
  return null;
}

// Unicode-aware so accented and non-Latin names survive typing instead of
// falling through to the regex detectors (which are ASCII-only).
const NAME_TOKEN_RE = /^[\p{L}][\p{L}'’.-]*$/u;
const NAME_START_RE = /^\p{Lu}/u;
const NAME_PARTICLES = new Set([
  'de', 'la', 'le', 'van', 'von', 'der', 'den', 'da', 'di', 'del', 'bin',
  'al', 'el', 'y', 'e', 'dos', 'das',
]);

function isNameToken(token) {
  if (CONNECTORS.has(token.toLowerCase()) || NAME_PARTICLES.has(token.toLowerCase())) return true;
  return NAME_TOKEN_RE.test(token) && NAME_START_RE.test(token);
}

/**
 * A plausible human name. Covers a single token (a split First/Last Name
 * column), the CRM "Doe, Jane" form, all-caps mainframe exports, and accented
 * letters. Digits, emails and URLs are never names.
 */
export function looksLikeName(text) {
  const value = String(text ?? '').trim();
  if (!value || value.length > 80) return false;
  if (/[@\d]/.test(value) || /^https?:/i.test(value)) return false;

  const comma = /^([\p{L}][\p{L}'’.-]*),\s*([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3})$/u.exec(value);
  if (comma) {
    const tokens = [comma[1], ...comma[2].split(/\s+/)];
    return tokens.length <= 5 && tokens.every(isNameToken);
  }

  const tokens = value.split(/\s+/);
  if (tokens.length > 5) return false;
  if (tokens.length === 1) {
    return isNameToken(tokens[0]) && tokens[0].length >= 2 && !NAME_STOPWORDS.has(tokens[0].toLowerCase());
  }
  return tokens.every(isNameToken);
}

// Words that make a capitalised multi-word value read as a business rather than
// a person. "Payee" columns are full of both, and turning "City Power & Light"
// into a person's name (then deriving "City" from it) corrupts the document.
const COMPANY_HINTS = new Set([
  'bank', 'market', 'foods', 'food', 'corporation', 'corp', 'company', 'co',
  'properties', 'property', 'dental', 'health', 'healthcare', 'insurance',
  'power', 'light', 'energy', 'services', 'service', 'group', 'partners',
  'holdings', 'capital', 'media', 'systems', 'solutions', 'technologies',
  'technology', 'labs', 'laboratory', 'studio', 'cafe', 'restaurant', 'hotel',
  'store', 'shop', 'trust', 'fund', 'associates', 'consulting', 'analytics',
  'logistics', 'industries', 'manufacturing', 'motors', 'airlines', 'railway',
  'university', 'school', 'clinic', 'hospital', 'pharmacy', 'supply', 'supplies',
  'inc', 'llc', 'ltd', 'plc', 'llp', 'gmbh', 'ventures', 'enterprises', 'works',
]);

/** A capitalised value that names a business rather than a person. */
export function looksLikeCompany(text) {
  const value = String(text ?? '').trim();
  if (!value || /[@\d]/.test(value)) return false;
  if (/\s&\s/.test(value)) return true;
  const words = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((word) => COMPANY_HINTS.has(word));
}

/** A company/organisation value: at least one letter, no contact details. */
export function looksLikeOrganization(text) {
  const value = String(text ?? '').trim();
  if (!value || value.length > 100) return false;
  if (/@/.test(value) || /^https?:/i.test(value)) return false;
  return /\p{L}/u.test(value) && !NAME_STOPWORDS.has(value.toLowerCase());
}

function digitsOnly(value) {
  return String(value).replace(/\D/g, '');
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTHS = new Map();
MONTH_NAMES.forEach((name, i) => {
  MONTHS.set(name, i + 1);
  MONTHS.set(name.slice(0, 3), i + 1);
});
MONTHS.set('sept', 9);

function monthNumber(name) {
  return MONTHS.get(String(name).toLowerCase().replace(/\.$/, '')) || 0;
}

export function parseDateParts(text) {
  const value = String(text).trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return { year: +match[1], month: +match[2], day: +match[3], format: 'iso' };
  match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value);
  if (match) return { year: +match[3], month: +match[1], day: +match[2], format: 'us' };
  // "April 17, 1986" / "Apr 17 1986" / "17 April 1986" — common in free text
  // and in DOCX paragraphs, where spreadsheets would store a real date cell.
  match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (match && monthNumber(match[1])) {
    return { year: +match[3], month: monthNumber(match[1]), day: +match[2], format: 'month-name', dayFirst: false, monthStyle: match[1].length <= 4 ? 'short' : 'long' };
  }
  match = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(value);
  if (match && monthNumber(match[2])) {
    return { year: +match[3], month: monthNumber(match[2]), day: +match[1], format: 'month-name', dayFirst: true, monthStyle: match[2].length <= 4 ? 'short' : 'long' };
  }
  return null;
}

function isRealDate(parts) {
  if (!parts) return false;
  const { year, month, day } = parts;
  if (year < 1900 || year > 2015 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIpv4(text) {
  const match = IPV4_RE.exec(String(text).trim());
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) <= 255);
}

/**
 * Validate and normalize one cell/leaf for a context type. Returning null means
 * "this value does not look like the column says it is", so the cell is left to
 * the ordinary text detectors instead of being rewritten blindly.
 * @param {string} type
 * @param {string|number} raw
 * @param {{amountBareIntegers?: boolean}} [opts]
 */
export function extractTypedValue(type, raw, opts = {}) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  switch (type) {
    case 'email':
      return EMAIL_RE.test(text) ? { original: text, type } : null;
    case 'phone': {
      const digits = digitsOnly(text);
      return PHONE_RE.test(text) && digits.length >= 10 && digits.length <= 15
        ? { original: text, type }
        : null;
    }
    case 'ssn': {
      if (!/^\d{3}-?\d{2}-?\d{4}$/.test(text)) return null;
      const digits = digitsOnly(text);
      const area = Number(digits.slice(0, 3));
      // 000/666/9xx are not issued; all-zero group/serial are placeholders.
      if (!area || area === 666 || area >= 900) return null;
      if (digits.slice(3, 5) === '00' || digits.slice(5) === '0000') return null;
      return { original: text, type };
    }
    case 'ssnPartial': {
      // A masked SSN or a bare last-four under a "SSN last 4" header.
      if (/^\d{4}$/.test(text) || /\d{4}(?!.*\d)/.test(text)) return { original: text, type };
      return null;
    }
    case 'medicalId': {
      return text.length >= 5 && text.length <= 30 && /\d/.test(text) && /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(text)
        ? { original: text, type }
        : null;
    }
    case 'swiftBic':
      return /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(text) ? { original: text, type } : null;
    case 'profileUrl': {
      if (/^@[A-Za-z0-9_.]{3,30}$/.test(text)) return { original: text, type };
      if (/^(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com|twitter\.com|x\.com)\/[A-Za-z0-9._%-]+$/i.test(text)) {
        return { original: text, type };
      }
      if (/^[A-Za-z0-9._-]{3,30}$/.test(text) && !/^\d+$/.test(text)) return { original: text, type };
      return null;
    }
    case 'iban':
      return ibanValid(text) ? { original: text, type } : null;
    case 'routing':
      return abaValid(text) && digitsOnly(text).length === 9 ? { original: text, type } : null;
    case 'account': {
      const digits = digitsOnly(text);
      if (/^[*xX•·\s-]+$/.test(text)) return null;
      const masked = /[*xX•·]/.test(text);
      if (masked ? digits.length >= 4 : digits.length >= 6 && digits.length <= 17) {
        return { original: text, type };
      }
      return null;
    }
    case 'card': {
      const digits = digitsOnly(text);
      if (luhnValid(digits)) return { original: text, type: 'creditCard' };
      if (/\d{4}/.test(text) && /[*xX•·]/.test(text)) return { original: text, type: 'creditCardPartial' };
      return null;
    }
    case 'creditCardPartial': {
      return /^\d{4}$/.test(text) || /\d{4}(?!.*\d)/.test(text) ? { original: text, type } : null;
    }
    case 'amount': {
      const parsed = parseAmount(text);
      if (parsed) return parsed.value === 0 ? null : { original: text, type };
      if (opts.amountBareIntegers !== false && /^-?\d+(?:\.\d{1,2})?$/.test(text)) {
        return Number(text) === 0 ? null : { original: text, type };
      }
      return null;
    }
    case 'name':
      if (!looksLikeName(text)) return null;
      // "Payee" / "Customer" columns hold companies too; a company keeps its
      // shape (and its legal suffix) instead of becoming a person.
      return looksLikeCompany(text)
        ? { original: text, type: 'organization' }
        : { original: text, type };
    case 'organization':
      return looksLikeOrganization(text) ? { original: text, type } : null;
    case 'dob': {
      const parts = parseDateParts(text);
      return isRealDate(parts) ? { original: text, type } : null;
    }
    case 'address':
      return /\d/.test(text) && /[A-Za-z]/.test(text) && text.length >= 8 && text.length <= 160
        ? { original: text, type }
        : null;
    case 'city':
      // Unicode: "São Paulo" and "Zürich" are cities too.
      return /^\p{L}[\p{L} .'-]{1,40}$/u.test(text) && !/\d/.test(text)
        ? { original: text, type }
        : null;
    case 'state':
      return /^[A-Z]{2}$/.test(text) ? { original: text, type } : null;
    case 'postalCode':
      // US ZIP+4, 4-digit Nordic codes, 6-digit Indian PINs, UK/Canada and the
      // Irish Eircode (which the numeric rule cannot see).
      if (/^\d{4,6}(?:-\d{3,4})?$/.test(text)) return { original: text, type };
      if (/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(text)) return { original: text, type };
      if (/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(text)) return { original: text, type };
      if (/^[A-Z]\d{2}\s[A-Z0-9]{4}$/i.test(text)) return { original: text, type };
      return null;
    case 'taxId': {
      const match = /^(\d{2})-?(\d{7})$/.exec(text);
      return match && einValid(`${match[1]}-${match[2]}`) ? { original: text, type } : null;
    }
    case 'passport':
      return /^[A-Z0-9]{8,9}$/.test(text) && /\d/.test(text) ? { original: text, type } : null;
    case 'license':
      return /^[A-Z0-9][A-Z0-9 -]{5,15}$/.test(text) && /\d/.test(text) ? { original: text, type } : null;
    case 'ipAddress':
      if (isIpv4(text) || ipv6Valid(text)) return { original: text, type };
      return null;
    case 'nationalId':
      return nationalIdScheme(text) ? { original: text, type } : null;
    case 'vin':
      return /^[A-HJ-NPR-Z0-9]{17}$/i.test(text) ? { original: text, type } : null;
    case 'coordinates': {
      const numbers = text.match(/-?\d+(?:\.\d+)?/g) || [];
      if (numbers.length === 0 || numbers.length > 2) return null;
      if (!numbers.every((n) => Math.abs(Number(n)) <= 180)) return null;
      return { original: text, type };
    }
    case 'cookie':
      return /=/.test(text) && text.length >= 8 && text.length <= 500 ? { original: text, type } : null;
    case 'cryptoWallet':
      if (/^0x[a-fA-F0-9]{40}$/.test(text)) return { original: text, type };
      if (/^bc1[a-z0-9]{25,62}$/.test(text)) return { original: text, type };
      if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(text)) return { original: text, type };
      return null;
    case 'password':
      return text.length >= 6 && !/\s/.test(text) ? { original: text, type } : null;
    case 'apiKey':
      return text.length >= 12 && /^[A-Za-z0-9_\-./+=]+$/.test(text) ? { original: text, type } : null;
    case 'recordId': {
      // EMP-2041, MRN-88213, HP-99281-04, TXN_88213 and bare numeric IDs.
      const shaped =
        /^[A-Za-z]{1,8}[-_ ]?\d{3,}(?:[-_]\d+)*$/.test(text) ||
        /^[A-Za-z0-9][A-Za-z0-9_-]{5,24}$/.test(text) ||
        /^\d{4,20}$/.test(text);
      return shaped && /\d/.test(text) ? { original: text, type } : null;
    }
    default:
      return null;
  }
}

export { normalizeIban };
