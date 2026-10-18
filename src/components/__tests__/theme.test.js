import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The UI is a strict black-and-white theme: grayscale only, no gradients.
const FORBIDDEN = /\b(?:bg|text|border|from|via|to|ring|accent|decoration|shadow|outline)-(?:slate|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b|gradient/;
const ALLOWED = [/neutral-/, /black/, /white/];

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') sourceFiles(full, out);
    } else if (/\.(jsx|js|css)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('black and white theme', () => {
  it('inverts the page: black base, white ink', () => {
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/background:\s*#000000/);
    expect(css).toMatch(/color:\s*#ffffff/);
  });

  it('uses no colored utility classes anywhere in src/', () => {
    const offenders = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(new RegExp(FORBIDDEN, 'g'))) {
        const token = match[0];
        if (!ALLOWED.some((ok) => ok.test(token))) offenders.push(`${file}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
