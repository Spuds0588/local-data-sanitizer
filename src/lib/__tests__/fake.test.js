import { describe, expect, it } from 'vitest';
import { generateFake } from '../fake.js';

describe('generateFake', () => {
  it('produces a value of the right shape per type', () => {
    expect(generateFake('email', 'x@y.com')).toMatch(/@/);
    expect(generateFake('phone', '(555) 123-4567')).toMatch(/\(\d{3}\) \d{3}-\d{4}/);
    expect(generateFake('ssn', '123-45-6789')).toMatch(/^\d{3}-\d{2}-\d{4}$/);
  });

  it('never reuses a fake value within a session (referential integrity)', () => {
    const used = new Set();
    const values = Array.from({ length: 30 }, () => generateFake('email', 'x@y.com', used));
    expect(new Set(values).size).toBe(values.length);
  });

  it('preserves the prefix of a codename', () => {
    expect(generateFake('custom', 'Project Phoenix')).toMatch(/^Project /);
  });

  it('preserves the shape of mixed tokens', () => {
    expect(generateFake('custom', 'ACME-4821')).toMatch(/^ACME-\d{4}$/);
  });
});
