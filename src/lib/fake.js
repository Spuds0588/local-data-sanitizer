// Deterministic-per-entry fake value generation, one type per detector.

import { faker } from '@faker-js/faker';
import { jiggleAmount, jiggleNumber } from './jiggle.js';
import { abaCheckDigit, ibanCheckDigits, normalizeIban } from './identifiers.js';
import { parseDateParts } from './columns.js';

// Words we keep when faking a custom "codename" (e.g. "Project Phoenix" -> "Project Alpha").
const KEEP_WORDS = new Set([
  'project', 'operation', 'op', 'client', 'account', 'company', 'team', 'code',
  'name', 'the', 'of', 'and', 'for', 'inc', 'llc', 'corp', 'ltd', 'group', 'fund',
]);

const isAllCapsWord = (w) => /^[A-Z]/.test(w);

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const randomDigit = () => Math.floor(Math.random() * 10);
const randomUpper = () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];

/** Replace every digit with a random digit, keeping length, separators and letters. */
function scrambleDigits(original) {
  let changed = false;
  let out = '';
  for (const ch of String(original)) {
    if (ch >= '0' && ch <= '9') {
      const digit = randomDigit();
      if (digit !== Number(ch)) changed = true;
      out += String(digit);
    } else {
      out += ch;
    }
  }
  // Keep a leading zero (and the original width) intact; a zero-width change is
  // still a change if the value itself had none.
  return changed ? out : original.replace(/\d/g, () => String(randomDigit()));
}

/** Collapse faker retries so a fake never equals the original or another fake. */
function retry(original, build, accept = () => true) {
  let candidate = build();
  for (let i = 0; i < 30; i += 1) {
    if (candidate !== original && accept(candidate)) return candidate;
    candidate = build();
  }
  return candidate;
}

/** \"John Smith\" -> another two-token name, with no token reused from the original. */
function fakeName(original) {
  const tokens = String(original).trim().split(/\s+/);
  const originalTokens = new Set(tokens.map((token) => token.toLowerCase()));
  const build = () => {
    const parts = [];
    const last = tokens.length - 1;
    for (let i = 0; i < tokens.length; i += 1) {
      if (i === 0) parts.push(faker.person.firstName());
      else if (i === last) parts.push(faker.person.lastName());
      else parts.push(faker.person.middleName());
    }
    return parts.join(' ');
  };
  return retry(
    original,
    build,
    (candidate) =>
      candidate.trim().split(/\s+/).every((token) => !originalTokens.has(token.toLowerCase())) &&
      candidate.trim().split(/\s+/).length === tokens.length,
  );
}

/** \"742 Evergreen Terrace, Springfield, IL 62704\" -> a new full address. */
function fakeAddress(original) {
  const street = faker.location.streetAddress();
  if (/,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}/.test(original)) {
    return `${street}, ${faker.location.city()}, ${faker.location.state({ abbreviated: true })} ${faker.location.zipCode()}`;
  }
  return street;
}

function fakeIban(original) {
  const iban = normalizeIban(original);
  const country = iban.slice(0, 2);
  const bbanLength = Math.max(11, Math.min(30, iban.length - 4));
  let bban = '';
  for (let i = 0; i < bbanLength; i += 1) bban += i % 3 === 2 ? randomUpper() : String(randomDigit());
  const fake = `${country}${ibanCheckDigits(country, bban)}${bban}`;
  // Preserve the original's 4-character grouping when it used spaces.
  return /\s/.test(original)
    ? fake.replace(/(.{4})/g, '$1 ').trim()
    : fake;
}

function fakeRouting(original) {
  const firstEight = Array.from({ length: 8 }, randomDigit).join('');
  return `${firstEight}${abaCheckDigit(firstEight)}`;
}

function fakeDob(original) {
  const parts = parseDateParts(original);
  if (!parts) return '1985-06-15';
  const year = parts.year + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 4));
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return parts.format === 'iso' ? `${year}-${mm}-${dd}` : `${mm}/${dd}/${year}`;
}

function fakeApiKey(original) {
  const value = String(original);
  const keepPrefix = (prefix) =>
    prefix + Array.from({ length: Math.max(0, value.length - prefix.length) }, () => (Math.random() < 0.5 ? randomDigit() : randomUpper())).join('');
  if (/^sk-proj-/i.test(value)) return keepPrefix(value.slice(0, 8));
  if (/^sk-/i.test(value)) return keepPrefix(value.slice(0, 3));
  if (/^AKIA/.test(value)) return 'AKIA' + Array.from({ length: 16 }, randomUpper).join('');
  if (/^gh[pousr]_/.test(value)) return keepPrefix(value.slice(0, 4));
  if (/^xox[baprs]-/.test(value)) return keepPrefix(value.slice(0, 5));
  if (/^eyJ/.test(value) && value.split('.').length === 3) {
    const segment = (length) => Array.from({ length }, () => (Math.random() < 0.5 ? randomDigit() : randomUpper())).join('');
    return `eyJ${segment(12)}.${segment(12)}.${segment(12)}`;
  }
  return keepPrefix('');
}

const lastFour = (value) => String(value).replace(/\D/g, '').slice(-4);

const FACTORIES = {
  email: () => faker.internet.email().toLowerCase(),
  // Valid NANP shape: area and exchange never start with 0 or 1.
  phone: () => {
    const part = (min) => `${faker.number.int({ min, max: 9 })}${String(faker.number.int({ min: 0, max: 99 })).padStart(2, '0')}`;
    const line = String(faker.number.int({ min: 0, max: 9999 })).padStart(4, '0');
    return `(${part(2)}) ${part(2)}-${line}`;
  },
  ssn: () => {
    const area = faker.number.int({ min: 101, max: 899 });
    const group = faker.number.int({ min: 10, max: 99 });
    const serial = faker.number.int({ min: 1000, max: 9999 });
    return `${area}-${group}-${serial}`;
  },
  creditCard: (original) => {
    // Never keep the real trailing digits: "ending in 1234" must not survive.
    const originalLastFour = lastFour(original);
    let candidate = faker.finance.creditCardNumber();
    for (let i = 0; i < 10 && lastFour(candidate) === originalLastFour; i += 1) {
      candidate = faker.finance.creditCardNumber();
    }
    return candidate;
  },
  creditCardPartial: (original) => {
    const originalLastFour = lastFour(original);
    let candidate = String(faker.number.int({ min: 1000, max: 9999 }));
    for (let i = 0; i < 10 && candidate === originalLastFour; i += 1) {
      candidate = String(faker.number.int({ min: 1000, max: 9999 }));
    }
    return candidate;
  },
  // Context types: the column header or key said what the value is.
  name: fakeName,
  account: scrambleDigits,
  routing: fakeRouting,
  iban: fakeIban,
  taxId: () => {
    const prefixes = [10, 20, 30, 40, 45, 47, 51, 61, 71, 81, 91, 93, 94, 95, 99];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${prefix}-${Array.from({ length: 7 }, randomDigit).join('')}`;
  },
  dob: fakeDob,
  address: fakeAddress,
  city: () => faker.location.city(),
  state: () => faker.location.state({ abbreviated: true }),
  postalCode: () => faker.location.zipCode(),
  passport: (original) =>
    /^[A-Z]\d{8}$/.test(original)
      ? `X${Array.from({ length: 8 }, randomDigit).join('')}`
      : Array.from({ length: Math.max(8, String(original).length) }, randomDigit).join(''),
  license: (original) =>
    String(original).replace(/\d/g, (digit) => {
      const next = randomDigit();
      return next === Number(digit) ? (next + 1) % 10 : next;
    }),
  ipAddress: (original) => {
    let candidate;
    do {
      candidate = Array.from({ length: 4 }, () => faker.number.int({ min: 1, max: 223 })).join('.');
    } while (candidate === original || /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(candidate));
    return candidate;
  },
  password: () => faker.internet.password({ length: 14 }),
  apiKey: fakeApiKey,
  recordId: scrambleDigits,
  custom: fakeCustom,
  // Not a fake identity: the same shape with a value shifted by up to ±20%.
  // Bare numbers come from numeric JSON leaves, where the original type was a
  // number (not a formatted string), so they stay numbers.
  amount: (original) => {
    const text = String(original);
    // Only an integer with no surface formatting is a raw numeric leaf. A
    // "4850.00" cell must keep its cents instead of collapsing to "5618".
    if (/^-?\d+$/.test(text)) return String(jiggleNumber(Number(text)));
    return jiggleAmount(text);
  },
};

/**
 * Custom secrets get a *shape-preserving* fake:
 *  - "John Smith"      -> a fake person name
 *  - "Project Phoenix" -> "Project <FakeWord>" (keeps the common prefix)
 *  - "ACME-4821"       -> same shape with random digits
 */
export function fakeCustom(original) {
  const tokens = String(original).trim().split(/\s+/);
  const allCapitalized = tokens.length > 1 && tokens.every(isAllCapsWord);
  const hasKeepWord = tokens.some((t) => KEEP_WORDS.has(t.toLowerCase()));

  if (allCapitalized && !hasKeepWord) {
    // Keep the token count stable: the engine maps each original token to the
    // matching fake token so "Smith" alone becomes the right surname later.
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    if (tokens.length === 2) return `${first} ${last}`;
    return tokens
      .map((_, i) => {
        if (i === 0) return first;
        if (i === tokens.length - 1) return last;
        return faker.person.middleName();
      })
      .join(' ');
  }

  return tokens
    .map((token) => {
      if (KEEP_WORDS.has(token.toLowerCase())) return token;
      if (/\d/.test(token)) {
        // Preserve the shape of mixed tokens (e.g. "ACME-4821" -> "ACME-7391").
        return token.replace(/\d+/g, (run) =>
          String(faker.number.int({ min: 10 ** (run.length - 1), max: 10 ** run.length - 1 })),
        );
      }
      if (token.length <= 2) return token;
      return titleCase(faker.word.adjective());
    })
    .join(' ');
}

/**
 * Generate a fake value for a detector type. `used` prevents two different
 * originals from colliding on the same fake (which would break referential
 * integrity when reviewing the document).
 * @param {string} type
 * @param {string} original
 * @param {Set<string>} [used]
 * @param {Set<string>} [forbidden] lowercased words that a fake name may not reuse
 */
export function generateFake(type, original, used = null, forbidden = null) {
  const factory = FACTORIES[type] || FACTORIES.custom;
  const reusesWord = (candidate) =>
    type === 'name' &&
    forbidden &&
    String(candidate)
      .toLowerCase()
      .split(/\s+/)
      .some((token) => forbidden.has(token));
  let candidate = factory(original);
  for (let i = 0; i < 25 && ((used && used.has(candidate)) || candidate === original || reusesWord(candidate)); i += 1) {
    candidate = factory(original);
  }
  if (used) used.add(candidate);
  return candidate;
}
