// Deterministic-per-entry fake value generation, one type per detector.

import { faker } from '@faker-js/faker';
import { jiggleAmount, jiggleNumber } from './jiggle.js';
import {
  abaCheckDigit,
  cpfComplete,
  ibanCheckDigits,
  luhnCheckDigit,
  nationalIdScheme,
  nhsCheckDigit,
  normalizeIban,
  tfnValid,
  verhoeffDigit,
} from './identifiers.js';
import { parseDateParts } from './columns.js';
import { fakeMrz } from './mrz.js';

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
  // Keep the original width; a zero-width change is still a change if the value
  // itself had none.
  if (!changed) out = String(original).replace(/\d/g, () => String(randomDigit()));
  // A leading zero is preserved. A number that never had one must not gain one:
  // a JSON numeric account (884201553) would silently lose a digit on write.
  if (String(original)[0] !== '0' && out[0] === '0') out = `${1 + (randomDigit() % 9)}${out.slice(1)}`;
  return out;
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

const NAME_TITLES = new Set(['dr', 'dr.', 'mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'prof', 'prof.', 'rev', 'rev.', 'sir', 'madam']);
const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'phd', 'md', 'esq', 'esq.', 'cpa']);
const NAME_PARTICLES = new Set(['de', 'la', 'le', 'van', 'von', 'der', 'den', 'da', 'di', 'del', 'bin', 'al', 'el', 'y', 'e', 'dos', 'das']);
const norm = (token) => String(token).toLowerCase().replace(/,$/, '');
const isKeptNameToken = (token) =>
  NAME_TITLES.has(norm(token)) || NAME_SUFFIXES.has(norm(token)) || NAME_PARTICLES.has(norm(token));

/**
 * "John Smith" -> another two-token name, with no name word reused from the
 * original. Titles, suffixes and particles ("Dr.", "Jr.", "van der") are kept
 * so a resume or legal document still reads like one. The CRM "Doe, Jane"
 * form keeps its comma and order.
 */
function fakeName(original) {
  const value = String(original).trim();
  const originalTokens = new Set(value.split(/\s+/).map(norm));

  const build = () => {
    const comma = /^([^,]+),\s*(.+)$/.exec(value);
    const groups = comma ? [comma[1].trim(), comma[2].trim()] : [value];
    const rendered = groups.map((group, groupIndex) => {
      const tokens = group.split(/\s+/);
      const nameCount = tokens.filter((token) => !isKeptNameToken(token)).length;
      let seen = 0;
      return tokens
        .map((token) => {
          if (isKeptNameToken(token)) return token;
          seen += 1;
          // In "Doe, Jane" the first group is the surname.
          if (comma) return groupIndex === 0 ? faker.person.lastName() : seen === 1 ? faker.person.firstName() : faker.person.middleName();
          if (seen === 1) return faker.person.firstName();
          if (seen === nameCount) return faker.person.lastName();
          return faker.person.middleName();
        })
        .join(' ');
    });
    return comma ? `${rendered[0]}, ${rendered[1]}` : rendered[0];
  };

  return retry(
    original,
    build,
    (candidate) =>
      candidate.trim().split(/\s+/).length === value.split(/\s+/).length &&
      candidate
        .trim()
        .split(/\s+/)
        .every((token) => isKeptNameToken(token) || !originalTokens.has(norm(token))),
  );
}

/** A fake company keeps the legal suffix (LLC, Inc) of the original. */
function fakeOrganization(original) {
  const suffix = /\b(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC|GmbH|Co\.?)\s*$/i.exec(String(original));
  const base = faker.company.name().replace(/\s*(LLC|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC|Group)\s*$/i, '');
  return suffix ? `${base} ${suffix[1]}` : base;
}

function fakeProfileUrl(original) {
  const username = () =>
    faker.internet
      .username()
      .replace(/[^A-Za-z0-9._-]/g, '')
      .slice(0, 24) || 'quietuser';
  const value = String(original);
  if (value.startsWith('@')) return `@${username()}`;
  if (/^(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com|twitter\.com|x\.com)\//i.test(value)) {
    return value.replace(/[A-Za-z0-9._%-]+$/, username());
  }
  return username();
}

/** \"742 Evergreen Terrace, Springfield, IL 62704\" -> a new full address. */
function fakeAddress(original) {
  const street = faker.location.streetAddress();
  if (/,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}/.test(original)) {
    // A ZIP+4 stays a ZIP+4 so the address still reads like the original.
    const zip = faker.location.zipCode(/\d{5}-\d{4}/.test(original) ? '#####-####' : '#####');
    return `${street}, ${faker.location.city()}, ${faker.location.state({ abbreviated: true })} ${zip}`;
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

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = MONTH_LONG.map((name) => name.slice(0, 3));

function fakeDob(original) {
  const parts = parseDateParts(original);
  if (!parts) return '1985-06-15';
  // A date of birth is identifying on its own: shifting only the year leaves the
  // real month and day in place. Generate an unrelated adult birth date and
  // keep only the original's written format.
  const birth = faker.date.birthdate({ min: 21, max: 79, mode: 'age' });
  const year = birth.getUTCFullYear();
  const month = birth.getUTCMonth() + 1;
  const day = birth.getUTCDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  if (parts.format === 'month-name') {
    const name = (parts.monthStyle === 'short' ? MONTH_SHORT : MONTH_LONG)[month - 1];
    const separator = /,/.test(String(original)) ? ',' : '';
    return parts.dayFirst ? `${day} ${name} ${year}` : `${name} ${day}${separator} ${year}`;
  }
  return parts.format === 'iso' ? `${year}-${mm}-${dd}` : `${mm}/${dd}/${year}`;
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomString(length, alphabet = ALNUM) {
  return Array.from({ length }, () => randomFrom(alphabet)).join('');
}

/**
 * Secrets keep the prefix that makes them recognisable (sk_live_, AIza, SG.,
 * npm_, AKIA…) and their width, so a reader can still tell what the key was.
 */
function fakeApiKey(original) {
  const value = String(original);
  const keep = (prefix, alphabet = ALNUM) => prefix + randomString(Math.max(0, value.length - prefix.length), alphabet);

  if (/^https:\/\/hooks\.slack\.com\/services\//i.test(value)) {
    const parts = value.slice(value.indexOf('/services/') + 10).split('/');
    return `https://hooks.slack.com/services/${parts.map((part) => randomString(part.length, UPPER + '0123456789')).join('/')}`;
  }
  if (/^SG\./.test(value)) {
    return value
      .split('.')
      .map((part, index) => (index === 0 ? part : randomString(part.length, `${ALNUM}_-`)))
      .join('.');
  }
  if (/^sk-proj-/i.test(value)) return keep(value.slice(0, 8));
  if (/^sk_live_/i.test(value)) return keep(value.slice(0, 8));
  if (/^sk_test_/i.test(value)) return keep(value.slice(0, 8));
  if (/^rk_live_/i.test(value)) return keep(value.slice(0, 8));
  if (/^rk_test_/i.test(value)) return keep(value.slice(0, 8));
  if (/^sk-/i.test(value)) return keep(value.slice(0, 3));
  if (/^AIza/.test(value)) return keep('AIza');
  if (/^npm_/.test(value)) return keep(value.slice(0, 4));
  if (/^AKIA/.test(value)) return 'AKIA' + randomString(16, UPPER);
  if (/^SK[0-9a-fA-F]{32}$/.test(value)) return 'SK' + randomString(32, HEX);
  if (/^shpat_[a-f0-9]+$/i.test(value)) return keep(value.slice(0, 6), HEX);
  if (/^dop_v1_[a-f0-9]+$/i.test(value)) return keep(value.slice(0, 7), HEX);
  if (/^gh[pousr]_/.test(value)) return keep(value.slice(0, 4));
  if (/^xox[baprs]-/.test(value)) return keep(value.slice(0, 5));
  if (/^eyJ/.test(value) && value.split('.').length === 3) {
    const segment = (length) => randomString(length, ALNUM);
    return `eyJ${segment(12)}.${segment(12)}.${segment(12)}`;
  }
  const generic = /^([A-Za-z]{2,12}[_-])/.exec(value);
  if (generic) return keep(generic[1]);
  return randomString(value.length);
}

const lastFour = (value) => String(value).replace(/\D/g, '').slice(-4);

const digits = (length) => Array.from({ length }, randomDigit).join('');
const HEX = '0123456789abcdef';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const randomFrom = (alphabet) => alphabet[Math.floor(Math.random() * alphabet.length)];

/** National IDs keep the country's shape (and its checksum) after replacement. */
function fakeNationalId(original) {
  const value = String(original);
  const scheme = nationalIdScheme(value);
  const grouped = /\s/.test(value);
  const dashed = /-/.test(value);
  const join = (groups) => (dashed ? groups.join('-') : grouped ? groups.join(' ') : groups.join(''));

  if (scheme === 'ni') {
    const letters = 'ABCEGHJKLMNPRSTWXYZ';
    let prefix;
    do {
      prefix = randomFrom(letters) + randomFrom(letters);
    } while (['BG', 'GB', 'NK', 'KN', 'TN', 'NT', 'ZZ'].includes(prefix));
    const suffix = 'ABCD'[Math.floor(Math.random() * 4)];
    const body = digits(6);
    return grouped
      ? `${prefix} ${body.slice(0, 2)} ${body.slice(2, 4)} ${body.slice(4)} ${suffix}`
      : `${prefix}${body}${suffix}`;
  }
  if (scheme === 'cpf') {
    const full = cpfComplete(digits(9));
    return `${full.slice(0, 3)}.${full.slice(3, 6)}.${full.slice(6, 9)}-${full.slice(9)}`;
  }
  if (scheme === 'nhs') {
    let firstNine = digits(9);
    let check = nhsCheckDigit(firstNine);
    for (let i = 0; i < 20 && check === null; i += 1) {
      firstNine = digits(9);
      check = nhsCheckDigit(firstNine);
    }
    return `${firstNine.slice(0, 3)} ${firstNine.slice(3, 6)} ${firstNine.slice(6)}${check ?? '0'}`;
  }
  if (scheme === 'aadhaar') {
    const first = randomDigit() % 8 + 2;
    const body = `${first}${digits(10)}`;
    return `${body.slice(0, 4)} ${body.slice(4, 8)} ${body.slice(8)}${verhoeffDigit(body)}`;
  }
  if (scheme === 'sin') {
    const body = digits(8);
    return join([body.slice(0, 3), body.slice(3, 6), `${body.slice(6)}${luhnCheckDigit(body)}`]);
  }
  if (scheme === 'tfn') {
    let candidate = digits(9);
    for (let i = 0; i < 20 && !tfnValid(candidate); i += 1) candidate = digits(9);
    return grouped ? `${candidate.slice(0, 3)} ${candidate.slice(3, 6)} ${candidate.slice(6)}` : candidate;
  }
  if (scheme === 'dni') {
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
    const body = digits(8);
    return `${body}${letters[Number(body) % 23]}`;
  }
  if (scheme === 'pesel') {
    // Pick a real date, encode the century in the month offset, then solve for
    // the check digit so the result still validates.
    const year = faker.number.int({ min: 1950, max: 2005 });
    const month = faker.number.int({ min: 1, max: 12 });
    const day = faker.number.int({ min: 1, max: 28 });
    const offset = year >= 2000 ? 20 : year >= 1900 ? 0 : 80;
    const head = `${String(year % 100).padStart(2, '0')}${String(month + offset).padStart(2, '0')}${String(day).padStart(2, '0')}${digits(4)}`;
    const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
    const sum = weights.reduce((acc, weight, index) => acc + weight * Number(head[index]), 0);
    return `${head}${(10 - (sum % 10)) % 10}`;
  }
  return scrambleDigits(value);
}

function fakeMac(original) {
  const separator = String(original).includes('-') ? '-' : ':';
  const upper = /[A-F]/.test(String(original));
  const pairs = Array.from({ length: 6 }, () => `${randomFrom(HEX)}${randomFrom(HEX)}`);
  const value = pairs.join(separator);
  return upper ? value.toUpperCase() : value;
}

function fakeWallet(original) {
  const value = String(original);
  if (/^0x/i.test(value)) return `0x${Array.from({ length: 40 }, () => randomFrom(HEX)).join('')}`;
  if (/^bc1/i.test(value)) {
    return `bc1${Array.from({ length: Math.max(25, value.length - 3) }, () => randomFrom('023456789acdefghjklmnpqrstuvwxyz')).join('')}`;
  }
  const length = Math.max(26, Math.min(34, value.length));
  return `${value[0]}${Array.from({ length: length - 1 }, () => randomFrom(BASE58)).join('')}`;
}

function fakePrivateKey(original) {
  const value = String(original);
  const begin = /-----BEGIN [^-]+-----/.exec(value)?.[0] || '-----BEGIN PRIVATE KEY-----';
  const end = /-----END [^-]+-----/.exec(value)?.[0] || '-----END PRIVATE KEY-----';
  const lines = Array.from({ length: 12 }, () =>
    Array.from({ length: 64 }, () => randomFrom(`${HEX}ABCDEFGHIJKLMNOPQRSTUVWXYZ+/`)).join(''),
  );
  return `${begin}\n${lines.join('\n')}\n${end}`;
}

function fakeCredentialUrl(original) {
  const value = String(original);
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value)?.[1] || 'https';
  const user = faker.internet.username().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16) || 'appuser';
  const password = faker.internet.password({ length: 14 });
  // Keep the port, database name and query so the connection string still
  // describes the same kind of connection after scrubbing.
  try {
    const url = new URL(value);
    url.username = user;
    url.password = password;
    url.hostname = faker.internet.domainName();
    return url.toString();
  } catch {
    return `${scheme}://${user}:${password}@${faker.internet.domainName()}`;
  }
}

const COOKIE_ATTRIBUTES = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'httponly', 'secure', 'version', 'priority']);

/** Cookie values change; attribute names (Path, HttpOnly, …) stay readable. */
function fakeCookie(original) {
  return String(original)
    .split(';')
    .map((part) => {
      const text = part.trim();
      if (!text) return part;
      const eq = text.indexOf('=');
      if (eq === -1) return text;
      const name = text.slice(0, eq).trim();
      if (COOKIE_ATTRIBUTES.has(name.toLowerCase())) return text;
      const value = Array.from({ length: 32 }, () => randomFrom(HEX)).join('');
      return `${name}=${value}`;
    })
    .join('; ');
}

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const CA_POSTCODE = /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i;
const EIRCODE = /^[A-Z]\d{2}(\s?)[A-Z0-9]{4}$/i;
// Routing-key letters Eircode actually uses; letters are kept where letters
// were so the code still looks Irish instead of like a UK postcode.
const EIRCODE_LETTERS = 'ACDEFHKNPRTVWXY';

/** Postcodes keep their country's pattern: letters where letters were. */
function fakePostalCode(original) {
  const value = String(original).trim();
  const fill = (pattern) =>
    [...pattern].map((ch) => {
      if (/[A-Za-z]/.test(ch)) {
        const letter = randomFrom('ABCDEFGHJKLMNPRSTVWXYZ');
        return /[a-z]/.test(ch) ? letter.toLowerCase() : letter;
      }
      if (/\d/.test(ch)) return String(randomDigit());
      return ch;
    }).join('');

  if (EIRCODE.test(value)) {
    const unique = value.slice(-4);
    const space = /\s/.test(value) ? ' ' : '';
    const tail = [...unique]
      .map((ch) => (/[A-Za-z]/.test(ch) ? randomFrom(EIRCODE_LETTERS) : String(randomDigit())))
      .join('');
    return `${randomFrom(EIRCODE_LETTERS)}${String(randomDigit())}${String(randomDigit())}${space}${tail}`;
  }
  if (UK_POSTCODE.test(value)) return fill(value);
  if (CA_POSTCODE.test(value)) return fill(value);

  const widthOf = (text) => (String(text).match(/\d/g) || []).length;
  const [first, second] = value.split('-');
  if (second) {
    return `${faker.location.zipCode('#'.repeat(Math.min(6, Math.max(4, widthOf(first) || 5))))}-${faker.location.zipCode('#'.repeat(widthOf(second) || 4))}`;
  }
  return faker.location.zipCode('#'.repeat(Math.min(6, Math.max(4, widthOf(first) || 5))));
}

function fakeCoordinates(original) {
  const values = String(original).match(/-?\d+(?:\.\d+)?/g) || [];
  const shift = (raw) => {
    const number = Number(raw);
    const delta = (Math.random() - 0.5) * 0.1;
    const decimals = (String(raw).split('.')[1] || '').length;
    return (number + delta).toFixed(decimals);
  };
  let index = 0;
  return String(original).replace(/-?\d+(?:\.\d+)?/g, (raw) => shift(values[index++]));
}

/** UK sort code / AU BSB / CLABE keep their separators; IFSC keeps its shape. */
function fakeBankCode(original) {
  const value = String(original);
  if (/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(value)) {
    return `${Array.from({ length: 4 }, randomUpper).join('')}0${Array.from({ length: 6 }, () =>
      randomFrom('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    ).join('')}`;
  }
  return value.replace(/\d/g, () => randomDigit());
}

/** A plate keeps letters where letters were and digits where digits were. */
function fakePlate(original) {
  return String(original).replace(/[A-Za-z0-9]/g, (ch) =>
    /[A-Za-z]/.test(ch) ? randomUpper() : String(randomDigit()),
  );
}

const FACTORIES = {
  email: () => faker.internet.email().toLowerCase(),
  // Valid NANP shape: area and exchange never start with 0 or 1. The original's
  // punctuation is kept so a bare CSV cell stays bare and an E.164 number keeps
  // its +1 prefix.
  phone: (original) => {
    const value = String(original);
    const allDigits = value.replace(/\D/g, '');
    // Preserve the exact punctuation and country prefix: a bare CSV cell stays
    // bare, "+1 (415) 555-0138" stays parenthesized, "206-555-0177" keeps dashes.
    const country = /^\+(\d{1,3})/.exec(value);
    const keep = country ? country[1].length : Math.max(0, allDigits.length - 10);
    const remaining = allDigits.length - keep;
    const nanp = () => {
      const part = (min) => `${faker.number.int({ min, max: 9 })}${String(faker.number.int({ min: 0, max: 99 })).padStart(2, '0')}`;
      return `${part(2)}${part(2)}${String(faker.number.int({ min: 0, max: 9999 })).padStart(4, '0')}`;
    };
    // NANP numbers are 10 digits; longer international numbers (+55, +91) keep
    // their width instead of running past the generated digits.
    const local =
      remaining === 10
        ? nanp()
        : Array.from({ length: Math.max(0, remaining) }, (_, i) =>
            i === 0 ? String(faker.number.int({ min: 1, max: 9 })) : String(faker.number.int({ min: 0, max: 9 })),
          ).join('');
    let generated = 0;
    let seen = 0;
    return value.replace(/\d/g, () => {
      const index = seen;
      seen += 1;
      if (index < keep) return allDigits[index];
      return local[generated++];
    });
  },
  ssn: (original) => {
    const dashed = String(original).includes('-');
    let candidate;
    do {
      const area = faker.number.int({ min: 101, max: 899 });
      const group = faker.number.int({ min: 10, max: 99 });
      const serial = faker.number.int({ min: 1000, max: 9999 });
      candidate = dashed ? `${area}-${group}-${serial}` : `${area}${group}${serial}`;
    } while (candidate === original);
    return candidate;
  },
  ssnPartial: (original) => {
    const value = String(original);
    const lastFour = value.replace(/\D/g, '').slice(-4);
    let fakeFour = String(faker.number.int({ min: 1000, max: 9999 }));
    while (fakeFour === lastFour) fakeFour = String(faker.number.int({ min: 1000, max: 9999 }));
    return /\d{4}(?!.*\d)/.test(value) ? value.replace(/\d{4}(?!.*\d)/, fakeFour) : fakeFour;
  },
  medicalId: scrambleDigits,
  swiftBic: (original) =>
    String(original)
      .split('')
      .map((ch) => {
        if (/[A-Z]/i.test(ch)) return randomUpper();
        if (/\d/.test(ch)) return String(randomDigit());
        return ch;
      })
      .join(''),
  organization: fakeOrganization,
  profileUrl: fakeProfileUrl,
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
  taxId: (original) => {
    const prefixes = [10, 20, 30, 40, 45, 47, 51, 61, 71, 81, 91, 93, 94, 95, 99];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${prefix}${String(original).includes('-') ? '-' : ''}${Array.from({ length: 7 }, randomDigit).join('')}`;
  },
  dob: fakeDob,
  address: fakeAddress,
  city: () => faker.location.city(),
  state: () => faker.location.state({ abbreviated: true }),
  postalCode: fakePostalCode,
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
  // A directory export stores `{SSHA}…` or a bcrypt hash, not a plaintext
  // password. Replacing one with a readable password would make the LDIF look
  // wrong (and hint that the field is no longer a hash), so keep the scheme.
  password: (original) => {
    const value = String(original);
    const scheme = /^\{[A-Z0-9]+\}/.exec(value);
    if (scheme) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const length = Math.max(20, value.length - scheme[0].length);
      return `${scheme[0]}${Array.from({ length }, () => randomFrom(alphabet)).join('')}`;
    }
    if (/^\$2[aby]\$/.test(value)) {
      const bcrypt = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      return `$2b$10$${Array.from({ length: 53 }, () => randomFrom(bcrypt)).join('')}`;
    }
    return faker.internet.password({ length: 14 });
  },
  apiKey: fakeApiKey,
  nationalId: fakeNationalId,
  mrz: fakeMrz,
  bankCode: fakeBankCode,
  plate: fakePlate,
  macAddress: fakeMac,
  cryptoWallet: fakeWallet,
  privateKey: fakePrivateKey,
  credentialUrl: fakeCredentialUrl,
  cookie: fakeCookie,
  coordinates: fakeCoordinates,
  ipv6: () => faker.internet.ipv6(),
  vin: (original) =>
    String(original)
      .split('')
      .map((ch) => (/[A-Za-z]/.test(ch) ? randomUpper() : randomDigit()).toString().replace(/[IOQ]/, 'A'))
      .join(''),
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
