// Standard regex detectors + custom keyword matching.

import { parseAmount } from './jiggle.js';

const CURRENCY_CODES = 'USD|EUR|GBP|JPY|CAD|AUD|CHF|INR|MXN|BRL';

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
  amount: {
    id: 'amount',
    label: 'Monetary amounts (±20% jiggle)',
    hint: '$1,234.56, USD 2,000, 5,000.00, 1200.75 — format kept',
    priority: 5,
    caseInsensitive: false,
    patterns: [
      // Symbol amounts: $1,234.56, -$1,200.00, ($1,234.56)
      /(?<![\w$€£¥₹])[-+]?\(?\s?[$€£¥₹]\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?(?!\d)(?!\.\d)(?!,\d)/g,
      // Currency-code amounts: USD 1,234.56, eur 2,000
      new RegExp(
        `\\b(?:${CURRENCY_CODES})\\s?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?(?!\\d)(?!\\.\\d)(?!,\\d)(?!\\s*%)`,
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
  rules: { email: true, phone: true, ssn: true, creditCard: true, creditCardPartial: true, amount: true },
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
      const re = new RegExp(pattern.source, pattern.flags);
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
