// Checksums and normalizers for account-style identifiers. Detection uses them
// to tell a real routing number / IBAN apart from an arbitrary digit run, and
// the fake generators reuse them so replacements stay structurally valid.

/** ABA routing number: 9 digits with the weighted mod-10 checksum. */
export function abaValid(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 9) return false;
  const d = digits.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/** Check digit that makes 9 digits a valid ABA routing number. */
export function abaCheckDigit(firstEight) {
  const d = String(firstEight).replace(/\D/g, '').padEnd(8, '0').slice(0, 8).split('').map(Number);
  const head = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5]);
  return String((10 - (head % 10)) % 10);
}

export function normalizeIban(value) {
  return String(value || '').replace(/[\s-]/g, '').toUpperCase();
}

/** ISO 7064 MOD-97-10 over a string of digits and A-Z letters. */
export function mod97(text) {
  let remainder = 0;
  for (const ch of String(text).toUpperCase()) {
    if (ch >= '0' && ch <= '9') {
      remainder = (remainder * 10 + Number(ch)) % 97;
    } else if (ch >= 'A' && ch <= 'Z') {
      remainder = (remainder * 100 + (ch.charCodeAt(0) - 55)) % 97;
    } else {
      return -1;
    }
  }
  return remainder;
}

/** IBAN: country + 2 check digits + 11..30 alphanumerics, MOD-97 valid. */
export function ibanValid(value) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.length > 34) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

/** The two check digits for a country + BBAN, so fakes stay valid IBANs. */
export function ibanCheckDigits(country, bban) {
  const check = 98 - mod97(`${bban}${country}00`);
  return String(check).padStart(2, '0');
}

/** US EIN shape (XX-XXXXXXX) with the prefixes the IRS actually issues. */
export function einValid(value) {
  const m = /^(\d{2})-\d{7}$/.exec(String(value).trim());
  if (!m) return false;
  return !['00', '07', '08', '09', '17', '18', '19', '28', '29', '49', '69', '70', '78', '79'].includes(m[1]);
}

const digitsOnly = (value) => String(value).replace(/\D/g, '');

/** Luhn check digit for a partial number (used by SIN and card fakes). */
export function luhnCheckDigit(partial) {
  const digits = digitsOnly(partial);
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Canadian Social Insurance Number: 9 digits with the Luhn check. */
export function sinValid(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 9) return false;
  if (/^(\d)\1{8}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** NHS number: 10 digits with the weighted mod-11 check digit. */
export function nhsValid(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  const expected = 11 - (sum % 11);
  const check = expected === 11 ? 0 : expected;
  return check !== 10 && check === Number(digits[9]);
}

/** Check digit to complete a 9-digit NHS prefix (null when unassignable). */
export function nhsCheckDigit(firstNine) {
  const digits = digitsOnly(firstNine).padStart(9, '0').slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  const expected = 11 - (sum % 11);
  const check = expected === 11 ? 0 : expected;
  return check === 10 ? null : String(check);
}

/** Brazilian CPF: 11 digits with two mod-11 check digits. */
export function cpfValid(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const digit = (length) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(digits[9]) && digit(10) === Number(digits[10]);
}

/** Complete a 9-digit CPF prefix with its two check digits. */
export function cpfComplete(firstNine) {
  const digits = digitsOnly(firstNine).padStart(9, '0').slice(0, 9);
  const digit = (length) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(9);
  const partial = digits + d1;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(partial[i]) * (11 - i);
  const rest = (sum * 10) % 11;
  return `${partial}${rest === 10 ? 0 : rest}`;
}

// Verhoeff tables (Aadhaar's check digit).
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValidate(digits) {
  let c = 0;
  const reversed = digits.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i += 1) c = V_D[c][V_P[i % 8][reversed[i]]];
  return c === 0;
}

/** Verhoeff check digit for a partial number (Aadhaar). */
export function verhoeffDigit(partial) {
  const digits = digitsOnly(partial);
  let c = 0;
  const reversed = digits.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i += 1) c = V_D[c][V_P[(i + 1) % 8][reversed[i]]];
  return String(V_P[0][c]);
}

/** Aadhaar: 12 digits whose last digit is the Verhoeff checksum. */
export function aadhaarValid(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 12 || digits[0] === '0' || digits[0] === '1') return false;
  return verhoeffValidate(digits);
}

/** Australian Tax File Number: 8 or 9 digits, weighted mod-11 sums to zero. */
export function tfnValid(value) {
  const digits = digitsOnly(value).padStart(9, '0');
  if (digits.length !== 9) return false;
  const weights = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * weights[i];
  return sum % 11 === 0;
}

/** UK National Insurance number shape: 2 letters, 6 digits, suffix A-D. */
export function niValid(value) {
  const text = String(value).trim().toUpperCase();
  const m = /^([A-CEGHJ-PR-TW-Z]{2})\s?(\d{2})\s?(\d{2})\s?(\d{2})\s?([A-D])$/.exec(text);
  if (!m) return false;
  return !['BG', 'GB', 'NK', 'KN', 'TN', 'NT', 'ZZ'].includes(m[1]);
}

/** IPv6 address: full or compressed, no clock-time false positives. */
export function ipv6Valid(value) {
  const text = String(value ?? '').trim();
  if (!/^[0-9A-Fa-f:]+$/.test(text) || !text.includes(':')) return false;
  if (text.includes(':::')) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  const parts = text.split(':');
  if (parts.some((part) => part.length > 4)) return false;
  const groups = text.includes('::') ? parts.filter(Boolean).length : parts.length;
  if (!text.includes('::') && groups !== 8) return false;
  if (text.includes('::') && groups > 7) return false;
  // "14:22:05" is a clock, not an address: a real address without a "::"
  // always has at least one 3-4 character group (or a compressed run).
  const hasLongGroup = parts.some((part) => part.length >= 3);
  return hasLongGroup || text.includes('::');
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Spanish DNI/NIE: 8 digits (or X/Y/Z + 7) followed by a checksum letter. */
export function dniValid(value) {
  const text = String(value ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (/^[XYZ]\d{7}[A-Z]$/.test(text)) {
    const number = Number(String('XYZ'.indexOf(text[0])) + text.slice(1, 8));
    return DNI_LETTERS[number % 23] === text[8];
  }
  const match = /^(\d{8})([A-Z])$/.exec(text);
  if (!match) return false;
  return DNI_LETTERS[Number(match[1]) % 23] === match[2];
}

/** Polish PESEL: 11 digits, weighted mod-10 check digit and an encoded month. */
export function peselValid(value) {
  const text = digitsOnly(value);
  if (text.length !== 11) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(text[i]) * weights[i];
  if ((10 - (sum % 10)) % 10 !== Number(text[10])) return false;
  const rawMonth = Number(text.slice(2, 4));
  const month = rawMonth > 80 ? rawMonth - 80 : rawMonth > 60 ? rawMonth - 60 : rawMonth > 40 ? rawMonth - 40 : rawMonth > 20 ? rawMonth - 20 : rawMonth;
  const day = Number(text.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Which national identifier a value is, so both detection and the fake
 * generator can treat it consistently.
 */
export function nationalIdScheme(value) {
  const text = String(value ?? '').trim();
  if (niValid(text)) return 'ni';
  if (cpfValid(text) && /[.-]/.test(text)) return 'cpf';
  if (nhsValid(text) && /\s/.test(text)) return 'nhs';
  if (aadhaarValid(text) && /\s/.test(text)) return 'aadhaar';
  if (sinValid(text) && /[ -]/.test(text)) return 'sin';
  if (tfnValid(text) && /\s/.test(text)) return 'tfn';
  if (dniValid(text)) return 'dni';
  if (peselValid(text)) return 'pesel';
  return null;
}
