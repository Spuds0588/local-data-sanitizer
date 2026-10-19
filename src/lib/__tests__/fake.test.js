import { describe, expect, it } from 'vitest';
import { generateFake } from '../fake.js';
import { dniValid, peselValid } from '../identifiers.js';
import { parseMrz } from '../mrz.js';

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

  it('keeps national ID checksums valid for DNI and PESEL', () => {
    for (let i = 0; i < 10; i += 1) {
      const dni = generateFake('nationalId', '12345678Z');
      expect(dni).toMatch(/^\d{8}[A-Z]$/);
      expect(dniValid(dni)).toBe(true);

      const pesel = generateFake('nationalId', '44051401359');
      expect(pesel).toMatch(/^\d{11}$/);
      expect(peselValid(pesel)).toBe(true);
    }
  });

  it('builds a valid MRZ of the same width', () => {
    const mrz = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
    const fake = generateFake('mrz', mrz);
    expect(fake.split('\n').map((line) => line.length)).toEqual([44, 44]);
    expect(parseMrz(fake)).toBeTruthy();
  });

  it('keeps a hashed password a hash', () => {
    expect(generateFake('password', '{SSHA}5en6G6MezRroT3XKqkdPOmY/BfQ=')).toMatch(/^\{SSHA\}[A-Za-z0-9+/]{20,}$/);
    expect(generateFake('password', '$2b$10$abcdefghijklmnopqrstuv')).toMatch(/^\$2b\$10\$/);
  });

  it('preserves the shape of mixed tokens', () => {
    expect(generateFake('custom', 'ACME-4821')).toMatch(/^ACME-\d{4}$/);
  });
});
