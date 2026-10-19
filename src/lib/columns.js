// Context-aware classification: a spreadsheet header or a JSON key says what a
// value *is*, which is exactly what bare identifiers lack. A 9-digit account
// number, a whole-dollar balance and a customer name are all invisible to pure
// text regexes; "account number", "balance" and "full name" are not.

import { parseAmount } from './jiggle.js';
import { luhnValid } from './rules.js';
import { abaValid, einValid, ibanValid, normalizeIban } from './identifiers.js';

const MONEY_WORDS = new Set([
  'amount', 'balance', 'subtotal', 'total', 'price', 'cost', 'debit', 'credit',
  'salary', 'wage', 'fee', 'tax', 'payment', 'deposit', 'withdrawal', 'net',
  'gross', 'due', 'paid', 'refund', 'rent', 'income', 'revenue', 'charge',
]);

const NAME_WORDS = new Set([
  'name', 'payee', 'customer', 'employee', 'beneficiary', 'cardholder',
  'applicant', 'contact', 'spouse', 'holder', 'employer', 'landlord', 'tenant',
  'agent', 'assignee', 'representative',
]);

const ID_OWNERS = new Set([
  'user', 'customer', 'member', 'employee', 'client', 'account', 'transaction',
  'txn', 'reference', 'ref', 'confirmation', 'ticket', 'record', 'patient',
  'student', 'policy', 'order',
]);

const CONNECTORS = new Set(['&', 'of', 'the', 'and', 'for']);

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?\d{0,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}$/;
const SSN_RE = /^\d{3}-\d{2}-\d{4}$/;
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
  if (has('phone') || has('mobile') || has('tel') || has('telephone') || has('cell')) return 'phone';
  if (joined.includes('ssn') || joined.includes('socialsecurity')) return 'ssn';
  if (has('dob') || (has('birth') && has('date')) || joined === 'birthdate' || has('born')) return 'dob';
  if (has('iban')) return 'iban';
  if (has('routing') || has('aba') || has('rtn')) return 'routing';

  // "Account Holder" is a person; "Account Number"/"Account" is the number.
  if (has('account') || has('acct')) {
    if (has('holder')) return 'name';
    if (has('id') && !has('number') && !has('no') && !has('num')) return 'recordId';
    if (hasId || words.length === 1) return 'account';
  }
  if (has('card') || has('cc') || has('pan')) return 'card';
  if ((has('tax') && has('id')) || has('ein') || has('tin')) return 'taxId';
  if (has('passport')) return 'passport';
  if (has('license') || has('licence') || has('dl')) return 'license';
  if (has('ip') || joined === 'ipaddress') return 'ipAddress';
  if (has('password') || has('passwd') || has('pwd')) return 'password';
  if (has('apikey') || has('secret') || has('token') || has('credential') || (has('access') && has('key'))) {
    return 'apiKey';
  }
  if (has('address') || has('street') || has('line1') || has('line2') || has('residence') || has('mailing')) {
    return 'address';
  }
  if (has('city') || has('town')) return 'city';
  // A two-letter state is too short to replace safely as free text; it stays.
  if (has('postal') || has('zip') || has('postcode')) return 'postalCode';
  // IDs before names: "Customer ID" is not a customer name.
  if (has('id') && ID_OWNERS.has(words[0])) return 'recordId';
  if (ID_OWNERS.has(joined) && ['reference', 'ref', 'ticket', 'transaction', 'txn', 'confirmation'].some((w) => joined.includes(w))) {
    return 'recordId';
  }
  if (words.some((word) => NAME_WORDS.has(word))) return 'name';
  if (words.some((word) => MONEY_WORDS.has(word))) return 'amount';
  return null;
}

/** A plausible human/organization name: 2-5 capitalized tokens, no digits. */
export function looksLikeName(text) {
  const tokens = String(text).trim().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;
  if (/\d/.test(text)) return false;
  return tokens.every(
    (token) =>
      /^[A-Za-z&'’.-]+$/.test(token) &&
      (CONNECTORS.has(token.toLowerCase()) || /^[A-Z]/.test(token)),
  );
}

function digitsOnly(value) {
  return String(value).replace(/\D/g, '');
}

export function parseDateParts(text) {
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim());
  if (match) return { year: +match[1], month: +match[2], day: +match[3], format: 'iso' };
  match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(String(text).trim());
  if (match) return { year: +match[3], month: +match[1], day: +match[2], format: 'us' };
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
    case 'ssn':
      return SSN_RE.test(text) ? { original: text, type } : null;
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
    case 'amount': {
      const parsed = parseAmount(text);
      if (parsed) return parsed.value === 0 ? null : { original: text, type };
      if (opts.amountBareIntegers !== false && /^-?\d+(?:\.\d{1,2})?$/.test(text)) {
        return Number(text) === 0 ? null : { original: text, type };
      }
      return null;
    }
    case 'name':
      return looksLikeName(text) ? { original: text, type } : null;
    case 'dob': {
      const parts = parseDateParts(text);
      return isRealDate(parts) ? { original: text, type } : null;
    }
    case 'address':
      return /\d/.test(text) && /[A-Za-z]/.test(text) && text.length >= 8 && text.length <= 160
        ? { original: text, type }
        : null;
    case 'city':
      return /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(text) && !/\d/.test(text)
        ? { original: text, type }
        : null;
    case 'state':
      return /^[A-Z]{2}$/.test(text) ? { original: text, type } : null;
    case 'postalCode':
      return /^\d{5}(?:-\d{4})?$/.test(text) ? { original: text, type } : null;
    case 'taxId':
      return einValid(text) ? { original: text, type } : null;
    case 'passport':
      return /^[A-Z0-9]{8,9}$/.test(text) && /\d/.test(text) ? { original: text, type } : null;
    case 'license':
      return /^[A-Z0-9][A-Z0-9 -]{5,15}$/.test(text) && /\d/.test(text) ? { original: text, type } : null;
    case 'ipAddress':
      return isIpv4(text) ? { original: text, type } : null;
    case 'password':
      return text.length >= 6 && !/\s/.test(text) ? { original: text, type } : null;
    case 'apiKey':
      return text.length >= 12 && /^[A-Za-z0-9_\-./+=]+$/.test(text) ? { original: text, type } : null;
    case 'recordId':
      return /^[A-Za-z]{1,6}[-_ ]?\d{3,}$/.test(text) || (/^[A-Za-z0-9]{6,20}$/.test(text) && /\d/.test(text))
        ? { original: text, type }
        : null;
    default:
      return null;
  }
}

export { normalizeIban };
