// OOXML text lives in runs: a name, email or account number is routinely split
// across several `<w:t>` / `<a:t>` nodes because of spell-check, formatting or
// editing history. Node-by-node substitution then leaves the pieces intact
// ("Jane" -> "Maria" next to " Doe" -> " Gonzalez" can still read as a leak).
//
// This module treats a paragraph as one string, finds matches across node
// boundaries, and writes the fake back through the same runs: formatting,
// tags, attributes and the rest of the package are untouched.

import { applyEntriesToText, escapeXml, entryMatcher } from '../text.js';

export const DOCX_PARAGRAPH = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
// `w:delText` carries tracked deletions. A name removed from the visible
// document still ships in the file, so it is read and rewritten as well.
export const DOCX_RUN = /(<w:(?:t|delText)\b[^>]*>)([^<]*)(<\/w:(?:t|delText)>)/g;
export const PPTX_PARAGRAPH = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
export const PPTX_RUN = /(<a:t\b[^>]*>)([^<]*)(<\/a:t>)/g;

function nodesOf(inner, runRe) {
  const nodes = [];
  const re = new RegExp(runRe.source, 'g');
  let m;
  while ((m = re.exec(inner)) !== null) {
    nodes.push({
      open: m[1],
      text: m[2],
      close: m[3],
      start: m.index,
      textStart: m.index + m[1].length,
      textEnd: m.index + m[1].length + m[2].length,
    });
  }
  return nodes;
}

/**
 * The readable text of one paragraph. Runs are joined without a separator
 * because the space belongs to whichever run Word put it in; a space inserted
 * here would turn a value split mid-word ("Jan" + "e") into two words.
 */
export function paragraphText(inner, runRe) {
  const text = nodesOf(inner, runRe)
    .map((node) => node.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/** Every paragraph's merged text, for detection. */
export function paragraphTexts(xml, paragraphRe, runRe) {
  const out = [];
  const re = new RegExp(paragraphRe.source, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = paragraphText(m[1], runRe);
    if (text) out.push(text);
  }
  return out;
}

export function mergedText(xml, paragraphRe, runRe) {
  const paragraphs = paragraphTexts(xml, paragraphRe, runRe);
  if (paragraphs.length) return paragraphs.join(' ');
  return nodesOf(xml, runRe)
    .map((node) => node.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distribute a fake across the runs the original occupied. When the split sits
 * on word boundaries (the common case: "Jane" + " Doe") the fake keeps that
 * shape, so bold/italic spans stay on the same words. Otherwise (a split email)
 * the fake is divided proportionally, snapping to a space when one is near, so
 * no run boundary is invented or removed.
 */
function splitFake(segments, fake) {
  if (segments.length === 1) return [fake];
  const words = fake.split(/\s+/).filter(Boolean);
  const perSegment = segments.map((segment) => segment.split(/\s+/).filter(Boolean).length);
  const totalWords = perSegment.reduce((sum, n) => sum + n, 0);
  if (words.length === totalWords && perSegment.every((n) => n > 0)) {
    const out = [];
    let cursor = 0;
    for (let i = 0; i < segments.length; i += 1) {
      const leading = /^\s*/.exec(segments[i])[0];
      const trailing = /\s*$/.exec(segments[i])[0];
      out.push(leading + words.slice(cursor, cursor + perSegment[i]).join(' ') + trailing);
      cursor += perSegment[i];
    }
    return out;
  }

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0) || 1;
  const out = [];
  let cursor = 0;
  let consumed = 0;
  for (let i = 0; i < segments.length - 1; i += 1) {
    consumed += segments[i].length;
    const target = Math.max(cursor, Math.round((fake.length * consumed) / totalLength));
    let cut = Math.min(fake.length, target);
    const prev = fake.lastIndexOf(' ', cut);
    const next = fake.indexOf(' ', cut);
    if (prev > cursor && next > cursor) cut = cut - prev <= next - cut ? prev : next;
    else if (prev > cursor) cut = prev;
    else if (next > cursor) cut = next;
    out.push(fake.slice(cursor, cut));
    cursor = cut;
  }
  out.push(fake.slice(cursor));
  return out;
}

const preserveSpace = (open, text) =>
  /^\s|\s$/.test(text) && !/xml:space=/.test(open) ? open.replace(/>$/, ' xml:space="preserve">') : open;

function sanitizeParagraph(inner, runRe, entries, keepSpace) {
  const nodes = nodesOf(inner, runRe);
  if (nodes.length === 0) return inner;

  const combined = nodes.map((node) => node.text).join('');
  if (!combined.trim()) return inner;

  const matcher = entryMatcher(entries);
  if (!matcher) return inner;

  let offset = 0;
  for (const node of nodes) {
    node.globalStart = offset;
    offset += node.text.length;
    node.globalEnd = offset;
  }

  const edits = nodes.map(() => []);
  const re = matcher.re;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(combined)) !== null) {
    const entry = matcher.resolve(m[0]);
    if (!entry) continue;
    const start = m.index;
    const end = start + m[0].length;

    let first = nodes.findIndex((node) => start < node.globalEnd && end > node.globalStart);
    if (first < 0) continue;
    const segments = [];
    const spans = [];
    for (let i = first; i < nodes.length && nodes[i].globalStart < end; i += 1) {
      const node = nodes[i];
      const from = Math.max(start, node.globalStart) - node.globalStart;
      const to = Math.min(end, node.globalEnd) - node.globalStart;
      segments.push(node.text.slice(from, to));
      spans.push({ node: i, from, to });
    }

    const pieces = splitFake(segments, String(entry.fakeValue));
    spans.forEach((span, i) => edits[span.node].push({ start: span.from, end: span.to, text: pieces[i] }));
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }

  // A value that sits wholly inside one run is invisible to the merged scan
  // when the adjacent run was concatenated without a space. Those runs are
  // still untouched, so a plain in-run pass can take them.
  nodes.forEach((node, i) => {
    if (edits[i].length) return;
    const replaced = applyEntriesToText(node.text, entries);
    if (replaced !== node.text) edits[i].push({ start: 0, end: node.text.length, text: replaced });
  });

  if (!edits.some((list) => list.length)) return inner;

  let out = '';
  let cursor = 0;
  nodes.forEach((node, i) => {
    let text = '';
    let at = 0;
    for (const edit of edits[i].sort((a, b) => a.start - b.start)) {
      text += node.text.slice(at, edit.start) + escapeXml(edit.text);
      at = edit.end;
    }
    text += node.text.slice(at);
    const open = keepSpace ? preserveSpace(node.open, text) : node.open;
    out += inner.slice(cursor, node.start) + open + text + node.close;
    cursor = node.textEnd + node.close.length;
  });
  return out + inner.slice(cursor);
}

/**
 * Runs that are not inside a paragraph at all. Real Word/PowerPoint files do
 * not produce these, but hand-built or third-party packages can, and a text
 * run must never be skipped just because its parent is unusual.
 */
function replaceStrayRuns(xml, paragraphRe, runRe, entries, keepSpace) {
  if (!entryMatcher(entries)) return xml;
  const ranges = [];
  const paragraphs = new RegExp(paragraphRe.source, 'g');
  let p;
  while ((p = paragraphs.exec(xml)) !== null) ranges.push([p.index, p.index + p[0].length]);

  const runs = new RegExp(runRe.source, 'g');
  let m;
  let out = '';
  let last = 0;
  while ((m = runs.exec(xml)) !== null) {
    if (ranges.some(([from, to]) => m.index >= from && m.index < to)) continue;
    const text = m[2];
    if (!text) continue;
    const replaced = applyEntriesToText(text, entries, { xmlSafe: true });
    if (replaced === text) continue;
    const open = keepSpace ? preserveSpace(m[1], replaced) : m[1];
    out += xml.slice(last, m.index) + open + replaced + m[3];
    last = m.index + m[0].length;
  }
  return out ? out + xml.slice(last) : xml;
}

/** Rewrite every paragraph of a part, run boundary or not. */
export function replaceInParagraphs(xml, { paragraphRe, runRe, entries, keepSpace = false }) {
  const updated = xml.replace(new RegExp(paragraphRe.source, 'g'), (full) => {
    if (!full.trim()) return full;
    const openEnd = full.indexOf('>') + 1;
    const closeStart = full.lastIndexOf('<');
    const inner = full.slice(openEnd, closeStart);
    if (!inner) return full;
    return full.slice(0, openEnd) + sanitizeParagraph(inner, runRe, entries, keepSpace) + full.slice(closeStart);
  });
  return replaceStrayRuns(updated, paragraphRe, runRe, entries, keepSpace);
}
