// ICAO 9303 machine-readable zones (passports, and the two-line ID variant).
//
// A 44-character MRZ is self-validating: the passport number, date of birth,
// expiry and the composite all carry check digits. That makes it one of the few
// free-text PII shapes that can be recognised with almost no false positives,
// and it matters because a scanned passport's text layer is exactly the kind of
// document people feed to an LLM.
//
// Replacement rebuilds a structurally valid MRZ of the same length from the
// original, so the document still looks like a passport page and the fields
// keep their positions (an LLM can still tell which line is the name, the
// document number, the birth date and the expiry).

import { faker } from '@faker-js/faker';

const WEIGHTS = [7, 3, 1];

/** ICAO check digit: letters are 10..35, '<' is 0. */
export function mrzCheckDigit(value) {
  let sum = 0;
  [...String(value)].forEach((ch, index) => {
    const code = ch === '<' ? 0 : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55;
    sum += code * WEIGHTS[index % 3];
  });
  return String(sum % 10);
}

function lineLength(value) {
  return String(value).split(/\r?\n/)[0].length;
}

/**
 * Parse a two-line passport MRZ and verify every check digit.
 * @returns {{name:string, nationality:string, passport:string, dob:string, sex:string, expiry:string, personal:string}|null}
 */
export function parseMrz(value) {
  const lines = String(value).split(/\r?\n/).map((line) => line.trimEnd());
  if (lines.length !== 2) return null;
  const [first, second] = lines;
  if (first.length !== second.length || first.length < 30) return null;
  if (!/^[A-Z]/.test(first[0]) || !/^[A-Z0-9<]+$/.test(first) || !/^[A-Z0-9<]+$/.test(second)) return null;

  const passport = second.slice(0, 9);
  const nationality = second.slice(10, 13);
  const dob = second.slice(13, 19);
  const sex = second[20];
  const expiry = second.slice(21, 27);
  const personal = second.slice(28, 42);
  const composite = second.slice(43, 44);

  const checks = [
    [passport, second[9]],
    [dob, second[19]],
    [expiry, second[27]],
    [personal.replace(/<+$/, ''), second[42]],
    [`${second.slice(0, 10)}${second.slice(13, 20)}${second.slice(21, 43)}`, composite],
  ];
  if (!checks.every(([input, digit]) => /^\d$/.test(digit || '') && mrzCheckDigit(input) === digit)) {
    return null;
  }
  if (!/^\d{6}$/.test(dob) || !/^\d{6}$/.test(expiry)) return null;
  if (!/^[MFX<]$/.test(sex)) return null;

  // Surname<<Given Names
  const name = first.slice(5).replace(/<+$/, '').replace(/<+/g, ' ').trim();
  return { name, nationality, passport, dob, sex, expiry, personal };
}

export function isMrz(value) {
  return parseMrz(value) !== null;
}

function mrzNamePart(text, length, padChar = '<') {
  const cleaned = String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, length);
  return cleaned.padEnd(length, padChar);
}

function mrzDate(offsetYears = 0) {
  const date = new Date(Date.UTC(
    faker.number.int({ min: 1950, max: 2004 }),
    faker.number.int({ min: 0, max: 11 }),
    faker.number.int({ min: 1, max: 28 }),
  ));
  date.setUTCFullYear(date.getUTCFullYear() + offsetYears);
  return `${String(date.getUTCFullYear() % 100).padStart(2, '0')}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function randomMrzDigits(length) {
  return Array.from({ length }, () => String(faker.number.int({ min: 0, max: 9 }))).join('');
}

/**
 * Rebuild an MRZ of the original's shape: same total length, same country
 * code and sex marker, same field positions, new name/numbers/dates.
 */
export function fakeMrz(original) {
  const parsed = parseMrz(original);
  const raw = String(original);
  const lines = raw.split(/\r?\n/);
  const width = lineLength(raw);
  const country = parsed?.nationality && /^[A-Z<]{3}$/.test(parsed.nationality) ? parsed.nationality : 'GBR';
  if (!parsed) {
    // Structurally invalid but MRZ-shaped: keep the shape, scramble the rest.
    return lines
      .map((line) => line.replace(/[A-Z0-9]/g, (ch) => (/\d/.test(ch) ? randomMrzDigits(1) : String.fromCharCode(65 + faker.number.int({ min: 0, max: 25 })))))
      .join('\n');
  }

  // `P<` + country + surname + `<<` + given names, padded to the line width.
  const surname = mrzNamePart(faker.person.lastName(), 19);
  const given = mrzNamePart(faker.person.firstName(), Math.max(1, width - 26));
  const first = `P<${country}${surname}<<${given}`.padEnd(width, '<').slice(0, width);

  // Keep the document number's shape: digits stay digits, letters stay
  // letters, so a numeric passport does not become alphanumeric.
  const passport = parsed.passport
    .replace(/[A-Z0-9]/g, (ch) =>
      /\d/.test(ch)
        ? randomMrzDigits(1)
        : String.fromCharCode(65 + faker.number.int({ min: 0, max: 25 })),
    )
    .slice(0, 9)
    .padEnd(9, '<');
  const dob = mrzDate();
  const expiry = mrzDate(10);
  const personal = parsed.personal.replace(/[A-Z0-9]/g, (ch) =>
    /\d/.test(ch) ? randomMrzDigits(1) : String.fromCharCode(65 + faker.number.int({ min: 0, max: 25 })),
  );
  const passportCheck = mrzCheckDigit(passport);
  const dobCheck = mrzCheckDigit(dob);
  const expiryCheck = mrzCheckDigit(expiry);
  const personalCheck = mrzCheckDigit(personal.replace(/<+$/, ''));
  const head = `${passport}${passportCheck}${country}${dob}${dobCheck}${parsed.sex}${expiry}${expiryCheck}${personal}${personalCheck}`;
  // The composite excludes the nationality field.
  const composite = mrzCheckDigit(
    `${passport}${passportCheck}${dob}${dobCheck}${expiry}${expiryCheck}${personal}${personalCheck}`,
  );
  const second = `${head}${composite}`;
  return `${first}\n${second.slice(0, width)}`;
}
