import { describe, expect, it } from 'vitest';
import { analyzeFiles, sanitizeFiles, scanTexts, canonicalKey } from '../engine.js';

const ALL = { rules: { email: true, phone: true, ssn: true, creditCard: true }, customKeywords: ['Project Phoenix'] };
const jsonFile = (obj, name = 'data.json') =>
  new File([JSON.stringify(obj)], name, { type: 'application/json' });

describe('canonicalKey', () => {
  it('lowercases case-insensitive types only', () => {
    expect(canonicalKey('email', 'A@B.com')).toBe('a@b.com');
    expect(canonicalKey('custom', 'Project Phoenix')).toBe('project phoenix');
    expect(canonicalKey('ssn', '123-45-6789')).toBe('123-45-6789');
  });
});

describe('scanTexts', () => {
  it('collapses identical originals into one entry with a hit count', () => {
    const found = scanTexts(['john@acme.com', 'ping JOHN@ACME.COM too'], {
      rules: { email: true },
      customKeywords: [],
    });
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(2);
    expect(found[0].context).toContain('[john@acme.com]');
  });
});

describe('analyzeFiles + sanitizeFiles (JSON)', () => {
  it('detects, assigns fake values, and rewrites the document end to end', async () => {
    const file = jsonFile({
      contact: 'John.Doe@Acme.com',
      nested: { card: '4111 1111 1111 1111' },
      list: ['call (555) 123-4567', 'Project Phoenix'],
      repeat: 'John.Doe@Acme.com',
    });

    const entries = await analyzeFiles([file], ALL);
    const byType = Object.fromEntries(entries.map((e) => [e.type, e]));
    expect(Object.keys(byType).sort()).toEqual(['creditCard', 'custom', 'email', 'phone']);
    expect(byType.email.count).toBe(2);

    const [result] = await sanitizeFiles([file], entries);
    const text = await result.blob.text();
    expect(text).not.toContain('John.Doe@Acme.com');
    expect(text).not.toContain('4111 1111 1111 1111');
    expect(text).not.toContain('(555) 123-4567');
    expect(text).not.toContain('Project Phoenix');
    // Referential integrity: both email occurrences became the same fake value.
    expect(text.split(byType.email.fakeValue).length - 1).toBe(2);
    expect(result.name).toBe('data.sanitized.json');
  });

  it('derives name tokens so partial mentions are replaced consistently', async () => {
    const file = jsonFile({ owner: 'John Smith', note: 'Smith called John back' });
    const entries = await analyzeFiles([file], { rules: {}, customKeywords: ['John Smith'] });
    const full = entries.find((e) => e.type === 'custom' && e.original === 'John Smith');
    const first = entries.find((e) => e.type === 'custom' && e.original === 'John');
    const last = entries.find((e) => e.type === 'custom' && e.original === 'Smith');
    expect(full).toBeTruthy();
    expect(first).toBeTruthy();
    expect(last).toBeTruthy();

    const [fakeFirst, fakeLast] = full.fakeValue.split(/\s+/);
    expect(first.fakeValue).toBe(fakeFirst);
    expect(last.fakeValue).toBe(fakeLast);

    const [result] = await sanitizeFiles([file], entries);
    const text = await result.blob.text();
    expect(text).not.toContain('John');
    expect(text).not.toContain('Smith');
    expect(text).toContain(full.fakeValue);
  });

  it('links a last-four fragment to the full card it belongs to', async () => {
    const file = jsonFile({ card: '4111 1111 1111 1111', note: 'charged to the card ending in 1111' });
    const entries = await analyzeFiles([file], {
      rules: { creditCard: true, creditCardPartial: true },
      customKeywords: [],
    });
    const card = entries.find((e) => e.type === 'creditCard');
    const fragment = entries.find((e) => e.type === 'creditCardPartial');
    expect(card).toBeTruthy();
    expect(fragment).toBeTruthy();

    const fakeLast4 = card.fakeValue.replace(/\D/g, '').slice(-4);
    expect(fakeLast4).not.toBe('1111');
    expect(fragment.fakeValue).toBe(`ending in ${fakeLast4}`);

    const [result] = await sanitizeFiles([file], entries);
    const text = await result.blob.text();
    expect(text).not.toContain('4111 1111 1111 1111');
    expect(text).not.toContain('ending in 1111');
    expect(text).toContain(`ending in ${fakeLast4}`);
  });

  it('honours disabled entries during execution', async () => {
    const file = jsonFile({ email: 'keep.me@acme.com' });
    const entries = (await analyzeFiles([file], ALL)).map((e) => ({ ...e, enabled: false }));
    const [result] = await sanitizeFiles([file], entries);
    expect(await result.blob.text()).toContain('keep.me@acme.com');
  });
});
