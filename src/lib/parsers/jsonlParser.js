// JSON Lines / NDJSON: application logs and event exports. One JSON value per
// line, so we transform each line as JSON (keeping numbers as numbers) and join
// the lines back with the original newline style. A line that is not JSON (a
// banner, a stack trace) falls back to text replacement instead of failing the
// whole file.

import { collectJsonMeta, sanitizeJsonValue } from './jsonParser.js';
import { applyEntriesToText, sanitizedName } from '../text.js';

function splitLines(text) {
  return text.split(/\r?\n/);
}

export async function detectWithMeta(file) {
  const text = await file.text();
  const segments = [];
  const moneyNumbers = [];
  const typedValues = [];

  for (const line of splitLines(text)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const meta = collectJsonMeta(parsed);
      segments.push(...meta.segments);
      moneyNumbers.push(...meta.moneyNumbers);
      typedValues.push(...meta.typedValues);
    } catch {
      // Non-JSON lines still go through the regex detectors.
      segments.push(line);
    }
  }

  console.log(
    `[JSONL Parser] ${file.name}: ${splitLines(text).length} line(s), ` +
      `${segments.length} value(s), ${typedValues.length} typed value(s).`,
  );
  return { segments, moneyNumbers, typedValues };
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

export async function sanitize(file, entries) {
  const text = await file.text();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(text);
  const textEntries = entries.filter((entry) => entry && entry.enabled !== false && !entry.numericOnly);
  const lines = splitLines(trailing ? text.slice(0, text.replace(/\r?\n$/, '').length) : text);

  const output = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      return JSON.stringify(sanitizeJsonValue(JSON.parse(line), entries));
    } catch {
      return applyEntriesToText(line, textEntries);
    }
  });

  const result = output.join(eol) + (trailing ? eol : '');
  console.log(`[JSONL Parser] ${file.name}: wrote ${output.length} line(s).`);
  return {
    blob: new Blob([result], { type: 'application/x-ndjson' }),
    name: sanitizedName(file.name, /\.[^.]+$/.exec(file.name)?.[1]?.toLowerCase() || 'jsonl'),
  };
}
