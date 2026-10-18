// Deterministic-per-entry fake value generation, one type per detector.

import { faker } from '@faker-js/faker';

// Words we keep when faking a custom "codename" (e.g. "Project Phoenix" -> "Project Alpha").
const KEEP_WORDS = new Set([
  'project', 'operation', 'op', 'client', 'account', 'company', 'team', 'code',
  'name', 'the', 'of', 'and', 'for', 'inc', 'llc', 'corp', 'ltd', 'group', 'fund',
]);

const isAllCapsWord = (w) => /^[A-Z]/.test(w);

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

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
    return faker.person.fullName();
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

const FACTORIES = {
  email: () => faker.internet.email().toLowerCase(),
  phone: () => faker.helpers.replaceSymbols('(###) ###-####'),
  ssn: () => {
    const area = faker.number.int({ min: 101, max: 899 });
    const group = faker.number.int({ min: 10, max: 99 });
    const serial = faker.number.int({ min: 1000, max: 9999 });
    return `${area}-${group}-${serial}`;
  },
  creditCard: () => faker.finance.creditCardNumber(),
  custom: fakeCustom,
};

/**
 * Generate a fake value for a detector type. `used` prevents two different
 * originals from colliding on the same fake (which would break referential
 * integrity when reviewing the document).
 * @param {string} type
 * @param {string} original
 * @param {Set<string>} [used]
 */
export function generateFake(type, original, used = null) {
  const factory = FACTORIES[type] || FACTORIES.custom;
  let candidate = factory(original);
  for (let i = 0; i < 25 && used && used.has(candidate); i += 1) {
    candidate = factory(original);
  }
  if (used) used.add(candidate);
  return candidate;
}
