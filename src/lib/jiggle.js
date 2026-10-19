// Value "jiggler": shift a monetary amount by up to ±20% while keeping its exact
// surface shape — currency mark, sign, accounting parentheses, thousands
// separators and decimal places — so a document keeps its structure without
// carrying the real figures.

export const JIGGLE_RATE = 0.2; // ±20%
const ATTEMPTS = 12; // never hand back the original value

const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'INR', 'MXN', 'BRL'];

// open? sign? gap? currency? gap? number close?
//   ($1,234.56)  -$1,234.56  USD 1,234.56  1,234.56  1200.75  $1,200
const AMOUNT_RE = new RegExp(
  '^(?<open>\\()?(?<sign>[-+])?(?<preGap>\\s?)(?<currency>[$€£¥₹]|' +
    CURRENCY_CODES.join('|') +
    ')?(?<gap>\\s?)(?<number>(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)(?<close>\\))?$',
  'i',
);

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function groupDigits(int) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Break an amount string into the pieces needed to rebuild it unchanged.
 * Returns null for anything that is not a single self-contained amount.
 * @param {string} text
 */
export function parseAmount(text) {
  const raw = String(text ?? '').trim();
  const match = AMOUNT_RE.exec(raw);
  if (!match) return null;
  const g = match.groups;
  if (g.open && !g.close) return null;
  // Without a currency mark demand a decimal or grouping, so plain integers
  // (counts, years, IDs) are never treated as money.
  if (!g.currency && !/[,.]/.test(g.number)) return null;

  const digits = g.number.replace(/,/g, '');
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;

  const fraction = digits.split('.')[1] || '';
  return {
    raw,
    value, // magnitude; sign style is tracked separately
    decimals: fraction.length,
    grouped: g.number.includes(','),
    currency: g.currency || '',
    open: g.open || '',
    close: g.close || '',
    sign: g.sign || '',
    preGap: g.preGap || '',
    gap: g.gap || '',
  };
}

/** Rebuild the amount in the original's format from a new magnitude. */
function formatAmount(parsed, magnitude) {
  const fixed = magnitude.toFixed(parsed.decimals);
  const [int, fraction] = fixed.split('.');
  const number = (parsed.grouped ? groupDigits(int) : int) + (fraction ? `.${fraction}` : '');
  const prefix = `${parsed.sign}${parsed.preGap}${parsed.currency}${parsed.gap}`;
  return `${parsed.open}${prefix}${number}${parsed.close}`;
}

/**
 * Apply the jiggle. `random` is injectable so tests can pin the direction.
 * The output is always a different value (unless the amount is zero, where a
 * percentage means nothing) and is never written outside the ±rate band.
 * @param {string} text
 * @param {{rate?: number, random?: () => number}} [opts]
 */
export function jiggleAmount(text, opts = {}) {
  const { rate = JIGGLE_RATE, random = Math.random } = opts;
  const parsed = parseAmount(text);
  if (!parsed) return text;
  if (parsed.value === 0) return text;

  const unit = 10 ** -parsed.decimals;
  let next = null;
  for (let i = 0; i < ATTEMPTS && next === null; i += 1) {
    const factor = 1 - rate + random() * 2 * rate;
    const candidate = round(parsed.value * factor, parsed.decimals);
    if (candidate > 0 && candidate !== parsed.value) next = candidate;
  }
  // Rounding can swallow a tiny percentage on very small values; nudge one
  // unit instead of returning the original.
  if (next === null) next = round(parsed.value + unit, parsed.decimals);

  return formatAmount(parsed, next);
}

/**
 * Percentage change between two amount strings, or null when either side is not
 * parseable. Used to show the reviewer how far a value moved.
 * @param {string} original
 * @param {string} fake
 */
export function amountChange(original, fake) {
  const from = parseAmount(original);
  const to = parseAmount(fake);
  if (!from || !to || from.value === 0) return null;
  return ((to.value - from.value) / from.value) * 100;
}
