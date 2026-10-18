import { describe, expect, it } from 'vitest';
import { applyEntriesToText, escapeXml, replaceAll, sanitizedName, escapeRegExp } from '../text.js';

describe('text helpers', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b(c)')).toBe('a\\.b\\(c\\)');
  });

  it('replaces literally, ignoring $ tokens in the replacement', () => {
    expect(replaceAll('price is X', 'X', '$99')).toBe('price is $99');
  });

  it('applies entries case-insensitively for emails', () => {
    const entries = [{ type: 'email', original: 'John.Doe@Acme.com', fakeValue: 'fake@x.com', enabled: true }];
    expect(applyEntriesToText('mail JOHN.DOE@ACME.COM now', entries)).toBe('mail fake@x.com now');
  });

  it('skips disabled entries', () => {
    const entries = [{ type: 'email', original: 'a@b.com', fakeValue: 'x@y.com', enabled: false }];
    expect(applyEntriesToText('a@b.com', entries)).toBe('a@b.com');
  });

  it('xml-escapes replacement values for DOCX', () => {
    const entries = [{ type: 'custom', original: 'Q', fakeValue: 'A & B <x>', enabled: true }];
    expect(applyEntriesToText('see Q', entries, { xmlSafe: true })).toBe('see A &amp; B &lt;x&gt;');
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });

  it('replaces the longest original first so a sub-string cannot break a full name', () => {
    const entries = [
      { type: 'custom', original: 'John', fakeValue: 'Ada', enabled: true },
      { type: 'custom', original: 'John Smith', fakeValue: 'Ada Lovelace', enabled: true },
    ];
    expect(applyEntriesToText('John Smith', entries)).toBe('Ada Lovelace');
  });

  it('names sanitized outputs', () => {
    expect(sanitizedName('report.docx', 'docx')).toBe('report.sanitized.docx');
    expect(sanitizedName('data.v2.csv', 'csv')).toBe('data.v2.sanitized.csv');
  });
});
