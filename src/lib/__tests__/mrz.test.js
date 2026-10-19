import { describe, expect, it } from 'vitest';
import { fakeMrz, isMrz, mrzCheckDigit, parseMrz } from '../mrz.js';

// ICAO 9303 specimen: a valid passport MRZ, not a real person.
const LINE1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const LINE2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
const MRZ = `${LINE1}\n${LINE2}`;

describe('mrzCheckDigit', () => {
  it('matches the specimen check digits', () => {
    expect(mrzCheckDigit('L898902C3')).toBe('6');
    expect(mrzCheckDigit('740812')).toBe('2');
    expect(mrzCheckDigit('120415')).toBe('9');
    expect(mrzCheckDigit('ZE184226B')).toBe('1');
  });

  it('treats < as zero', () => {
    expect(mrzCheckDigit('<<<')).toBe('0');
  });
});

describe('parseMrz', () => {
  it('reads every field of a valid passport MRZ', () => {
    expect(parseMrz(MRZ)).toEqual({
      name: 'ERIKSSON ANNA MARIA',
      nationality: 'UTO',
      passport: 'L898902C3',
      dob: '740812',
      sex: 'F',
      expiry: '120415',
      personal: 'ZE184226B<<<<<',
    });
  });

  it('rejects a single wrong check digit anywhere', () => {
    for (const index of [9, 19, 27, 42, 43]) {
      const tampered = `${LINE1}\n${LINE2.slice(0, index)}${LINE2[index] === '9' ? '8' : '9'}${LINE2.slice(index + 1)}`;
      expect(parseMrz(tampered), `position ${index}`).toBeNull();
    }
  });

  it('rejects text that is merely long and full of capitals', () => {
    expect(isMrz(`${'A'.repeat(44)}\n${'B'.repeat(44)}`)).toBe(false);
    expect(parseMrz('P<GBRDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<')).toBeNull();
  });
});

describe('fakeMrz', () => {
  it('produces a valid MRZ of the same width with different fields', () => {
    for (let i = 0; i < 5; i += 1) {
      const fake = fakeMrz(MRZ);
      const lines = fake.split('\n');
      expect(lines.map((line) => line.length)).toEqual([44, 44]);
      const parsed = parseMrz(fake);
      expect(parsed, fake).toBeTruthy();
      expect(parsed.passport).not.toBe('L898902C3');
      expect(parsed.dob).not.toBe('740812');
      expect(parsed.name).not.toContain('ERIKSSON');
      expect(parsed.sex).toBe('F');
      expect(parsed.nationality).toBe('UTO');
      expect(lines[0].startsWith('P<UTO')).toBe(true);
    }
  });

  it('keeps a numeric document number numeric', () => {
    const passport = '123456789';
    const dob = '740812';
    const expiry = '120415';
    const personal = '<<<<<<<<<<<<<<';
    const head = `${passport}${mrzCheckDigit(passport)}UTO${dob}${mrzCheckDigit(dob)}F${expiry}${mrzCheckDigit(expiry)}${personal}${mrzCheckDigit('')}`;
    const numeric = `P<GBRDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<\n${head}${mrzCheckDigit(`${head.slice(0, 10)}${head.slice(13, 20)}${head.slice(21, 43)}`)}`;
    expect(parseMrz(numeric)).toBeTruthy();

    const fake = fakeMrz(numeric);
    expect(parseMrz(fake)).toBeTruthy();
    expect(fake.split('\n')[1].slice(0, 9)).toMatch(/^\d{9}$/);
  });
});
