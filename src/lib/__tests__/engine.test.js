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

  it('honours disabled entries during execution', async () => {
    const file = jsonFile({ email: 'keep.me@acme.com' });
    const entries = (await analyzeFiles([file], ALL)).map((e) => ({ ...e, enabled: false }));
    const [result] = await sanitizeFiles([file], entries);
    expect(await result.blob.text()).toContain('keep.me@acme.com');
  });
});
