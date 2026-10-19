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
