import { describe, expect, it } from 'vitest';
import {
  aadhaarValid,
  cpfValid,
  dniValid,
  peselValid,
  ipv6Valid,
  nationalIdScheme,
  nhsValid,
  niValid,
  sinValid,
  tfnValid,
} from '../identifiers.js';

describe('national ID schemes', () => {
  it('recognises the schemes the claims fixture uses', () => {
    expect(nationalIdScheme('AB 12 34 56 C')).toBe('ni');
    expect(nationalIdScheme('943 476 5919')).toBe('nhs');
    expect(nationalIdScheme('529.982.247-25')).toBe('cpf');
    expect(nationalIdScheme('2341 2341 2346')).toBe('aadhaar');
    expect(nationalIdScheme('046-454-765')).toBe('sin');
  });

  it('rejects values whose check digit does not hold', () => {
    // NI numbers have a structural check, not a check digit: the A-D suffix is
    // not derived, but E is not a legal suffix at all.
    expect(nationalIdScheme('AB 12 34 56 D')).toBe('ni');
    expect(nationalIdScheme('AB 12 34 56 E')).toBeNull();
    expect(nationalIdScheme('943 476 5918')).toBeNull();
    expect(nationalIdScheme('529.982.247-26')).toBeNull();
    expect(nationalIdScheme('2341 2341 2347')).toBeNull();
    expect(nationalIdScheme('046-454-766')).toBeNull();
  });

  it('does not mistake ordinary numbers for IDs', () => {
    expect(nationalIdScheme('123-45-6789')).toBeNull();
    expect(nationalIdScheme('4509 1234 5678 9012')).toBeNull();
    expect(nationalIdScheme('2024-02-03')).toBeNull();
  });

  it('accepts the checksum helpers on their own', () => {
    expect(sinValid('046 454 765')).toBe(true);
    expect(sinValid('046 454 766')).toBe(false);
    expect(nhsValid('943 476 5919')).toBe(true);
    expect(nhsValid('943 476 5918')).toBe(false);
    expect(cpfValid('529.982.247-25')).toBe(true);
    expect(cpfValid('529.982.247-26')).toBe(false);
    expect(aadhaarValid('2341 2341 2346')).toBe(true);
    expect(niValid('AB 12 34 56 C')).toBe(true);
    // Q, D, F, I, O, U and V never appear in an NI number.
    expect(niValid('QQ 12 34 56 C')).toBe(false);
  });

  it('validates Spanish DNI/NIE and Polish PESEL', () => {
    expect(dniValid('12345678Z')).toBe(true);
    expect(dniValid('12345678A')).toBe(false);
    expect(dniValid('X1234567L')).toBe(true);
    expect(peselValid('44051401359')).toBe(true);
    expect(peselValid('44051401358')).toBe(false);
    // Month 13 is not a date, even when the checksum works out.
    expect(peselValid('44131401350')).toBe(false);
    expect(nationalIdScheme('12345678Z')).toBe('dni');
    expect(nationalIdScheme('44051401359')).toBe('pesel');
  });

  it('keeps the TFN checksum honest', () => {
    expect(tfnValid('123 456 782')).toBe(true);
    expect(tfnValid('123 456 783')).toBe(false);
  });
});

describe('ipv6Valid', () => {
  it('accepts compressed and full addresses', () => {
    expect(ipv6Valid('2001:db8:85a3::8a2e:370:7334')).toBe(true);
    expect(ipv6Valid('::1')).toBe(true);
    expect(ipv6Valid('fe80::1')).toBe(true);
    expect(ipv6Valid('2001:0db8:0000:0000:0000:ff00:0042:8329')).toBe(true);
  });

  it('rejects clocks, timestamps and over-long groups', () => {
    expect(ipv6Valid('14:22:05')).toBe(false);
    expect(ipv6Valid('2024:02:03')).toBe(false);
    expect(ipv6Valid('12345:db8::1')).toBe(false);
    expect(ipv6Valid('2001:db8:::1')).toBe(false);
  });
});
