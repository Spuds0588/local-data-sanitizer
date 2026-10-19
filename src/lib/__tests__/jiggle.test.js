import { describe, expect, it } from 'vitest';
import { amountChange, jiggleAmount, jiggleNumber, parseAmount } from '../jiggle.js';

const at = (random) => ({ random: () => random });

describe('parseAmount', () => {
  it('splits the shape of every supported amount', () => {
    expect(parseAmount('$1,234.56')).toMatchObject({
      value: 1234.56,
      decimals: 2,
      grouped: true,
      currency: '$',
      sign: '',
    });
    expect(parseAmount('USD 2,000')).toMatchObject({ value: 2000, decimals: 0, currency: 'USD', gap: ' ' });
    expect(parseAmount('($1,000.00)')).toMatchObject({ value: 1000, open: '(', close: ')' });
    expect(parseAmount('-$12.50')).toMatchObject({ value: 12.5, sign: '-' });
  });

  it('rejects text that is not a single amount', () => {
    expect(parseAmount('total $1,234.56')).toBeNull();
    expect(parseAmount('(1,234.56')).toBeNull();
    expect(parseAmount('1.234,56')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('jiggleAmount', () => {
  it('moves the value by the requested direction and keeps 2 decimals', () => {
    expect(jiggleAmount('$1,000.00', at(0))).toBe('$800.00');
    expect(jiggleAmount('$1,000.00', at(1))).toBe('$1,200.00');
    expect(jiggleAmount('$1,234.56', at(1))).toBe('$1,481.47');
  });

  it('keeps currency marks, spacing, signs and accounting parentheses', () => {
    expect(jiggleAmount('-$1,000.00', at(0))).toBe('-$800.00');
    expect(jiggleAmount('($1,000.00)', at(0))).toBe('($800.00)');
    expect(jiggleAmount('$ 1,000.00', at(0))).toBe('$ 800.00');
    expect(jiggleAmount('USD 1,000.00', at(0))).toBe('USD 800.00');
    expect(jiggleAmount('usd 1,000.00', at(0))).toBe('usd 800.00');
  });

  it('keeps grouping and decimal places, including integer amounts', () => {
    expect(jiggleAmount('5,000.00', at(0))).toBe('4,000.00');
    expect(jiggleAmount('1234.56', at(0))).toBe('987.65');
    expect(jiggleAmount('$1,200', at(0))).toBe('$960');
    expect(jiggleAmount('$1,200.5', at(0))).toBe('$960.4');
  });

  it('stays inside ±20% and never returns the original value', () => {
    const samples = ['$999.00', '$1,234.56', '7,777,777.77', '($45.10)', '-$3.50'];
    for (const original of samples) {
      for (let step = 0; step <= 20; step += 1) {
        const fake = jiggleAmount(original, at(step / 20));
        expect(fake).not.toBe(original);
        const change = amountChange(original, fake);
        // Allow for a hundredth of a percent of rounding at the edge.
        expect(Math.abs(change)).toBeLessThanOrEqual(20.01);
        expect(parseAmount(fake)).not.toBeNull();
      }
    }
  });

  it('moves by a cent when 20% is smaller than the smallest unit', () => {
    expect(jiggleAmount('$0.01', at(0.5))).toBe('$0.02');
    expect(jiggleAmount('$0.02', at(0.5))).toBe('$0.03');
  });

  it('leaves zero and non-amounts untouched', () => {
    expect(jiggleAmount('$0.00')).toBe('$0.00');
    expect(jiggleAmount('2024.01.15')).toBe('2024.01.15');
    expect(jiggleAmount('TX 4509123456789012')).toBe('TX 4509123456789012');
    expect(jiggleAmount('rate 123.45%')).toBe('rate 123.45%');
    expect(jiggleAmount('no money here')).toBe('no money here');
  });
});

describe('jiggleNumber', () => {
  it('keeps whole-dollar numbers whole and inside ±20%', () => {
    expect(jiggleNumber(1000, at(0))).toBe(800);
    expect(jiggleNumber(1000, at(1))).toBe(1200);
    expect(jiggleNumber(-1450, at(0))).toBe(-1160);
    expect(Number.isInteger(jiggleNumber(4250, at(0.5)))).toBe(true);
  });

  it('moves a number at the midpoint instead of returning it', () => {
    expect(jiggleNumber(4250, at(0.5))).toBe(4251);
    expect(jiggleNumber(-4250, at(0.5))).toBe(-4251);
  });

  it('keeps decimal precision and leaves zero alone', () => {
    expect(jiggleNumber(1234.56, at(0))).toBe(987.65);
    expect(jiggleNumber(0, at(0))).toBe(0);
    expect(jiggleNumber(Number.NaN, at(0))).toBeNaN();
  });
});

describe('amountChange', () => {
  it('reports the percentage shift', () => {
    expect(amountChange('$100.00', '$120.00')).toBeCloseTo(20);
    expect(amountChange('$100.00', '$80.00')).toBeCloseTo(-20);
    expect(amountChange('$0.00', '$10.00')).toBeNull();
    expect(amountChange('$100.00', 'nope')).toBeNull();
  });

  it('also measures bare numbers from numeric JSON leaves', () => {
    expect(amountChange('4250', '5100')).toBeCloseTo(20);
    expect(amountChange('4250', '3400')).toBeCloseTo(-20);
  });
});
