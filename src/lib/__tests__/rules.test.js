import { describe, expect, it } from 'vitest';
import { detectInText, luhnValid, digitCount } from '../rules.js';

const ALL = { rules: { email: true, phone: true, ssn: true, creditCard: true }, customKeywords: [] };

describe('luhnValid', () => {
  it('accepts a known-valid test card and rejects a bad one', () => {
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
    expect(luhnValid('4111 1111 1111 1112')).toBe(false);
    expect(luhnValid('123')).toBe(false);
  });
});

describe('detectInText', () => {
  it('finds every enabled rule type', () => {
    const text = 'Reach a.b@corp.io, call (555) 123-4567, SSN 123-45-6789, card 4111 1111 1111 1111.';
    const types = detectInText(text, ALL).map((m) => m.type);
    expect(types).toContain('email');
    expect(types).toContain('phone');
    expect(types).toContain('ssn');
    expect(types).toContain('creditCard');
  });

  it('respects disabled rules', () => {
    const found = detectInText('a@b.com', { rules: { email: false }, customKeywords: [] });
    expect(found).toHaveLength(0);
  });

  it('does not report an SSN as a phone number', () => {
    const found = detectInText('123-45-6789', { rules: { phone: true, ssn: true }, customKeywords: [] });
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('ssn');
  });

  it('rejects long digit runs that fail the Luhn check', () => {
    expect(detectInText('9999999999999999', { rules: { creditCard: true }, customKeywords: [] })).toHaveLength(0);
  });

  it('matches custom keywords case-insensitively and returns actual casing', () => {
    const found = detectInText('project phoenix and PROJECT PHOENIX', {
      rules: {},
      customKeywords: ['Project Phoenix'],
    });
    expect(found).toHaveLength(2);
    expect(found[0].value).toBe('project phoenix');
    expect(found[1].value).toBe('PROJECT PHOENIX');
  });

  it('gives non-empty digit counts for validation helpers', () => {
    expect(digitCount('(555) 123-4567')).toBe(10);
  });
});
