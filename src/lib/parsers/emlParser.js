// EML / MIME email. Exported mail is usually quoted-printable or base64, so
// searching the raw bytes finds almost nothing: the text has to be decoded,
// scrubbed, and re-encoded. This parser walks the MIME tree and does exactly
// that, leaving attachments (and anything undecodable) byte-for-byte alone.
//
// What stays stable: header names and order, the multipart boundary, part
// order, each part's Content-Transfer-Encoding, and the line endings. What
// changes: decoded text values, filenames and display names.

import { applyEntriesToText, sanitizedName } from '../text.js';
import { looksLikeName } from '../columns.js';

const MIME = 'message/rfc822';

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function splitMessage(text) {
  const match = /\r?\n\r?\n/.exec(text);
  if (!match) return { headerText: text, body: '', eol: eolOf(text) };
  return {
    headerText: text.slice(0, match.index),
    body: text.slice(match.index + match[0].length),
    eol: eolOf(text),
  };
}

/** Header lines with continuation lines joined into one logical value. */
export function parseHeaders(headerText, eol = '\r\n') {
  const headers = [];
  for (const line of headerText.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) {
      const last = headers[headers.length - 1];
      last.raw += eol + line;
      last.value += ` ${line.trim()}`;
      continue;
    }
    const match = /^([!-9;-~]+):[ \t]*([\s\S]*)$/.exec(line);
    if (!match) {
      headers.push({ name: '', value: line, raw: line });
      continue;
    }
    headers.push({ name: match[1], value: match[2], raw: line });
  }
  return headers;
}

function getHeader(headers, name) {
  const found = headers.find((header) => header.name.toLowerCase() === name);
  return found ? found.value : '';
}

/** `text/plain; charset="utf-8"` -> { type, params }. */
export function parseContentType(value) {
  const [type, ...rest] = String(value || '').split(';');
  const params = {};
  for (const part of rest) {
    const match = /^\s*([\w-]+)\s*=\s*("?)([\s\S]*?)\2\s*$/.exec(part);
    if (match) params[match[1].toLowerCase()] = match[3];
  }
  return { type: type.trim().toLowerCase(), params };
}

function base64ToBytes(text) {
  const binary = atob(String(text).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeCharset(bytes, charset) {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeQuotedPrintable(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '=') {
      if (text[i + 1] === '\r' && text[i + 2] === '\n') {
        i += 2;
        continue;
      }
      if (text[i + 1] === '\n') {
        i += 1;
        continue;
      }
      const hex = text.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(ch.charCodeAt(0));
  }
  return new Uint8Array(bytes);
}

function encodeQuotedPrintable(text) {
  const bytes = new TextEncoder().encode(String(text));
  let out = '';
  let lineLength = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 13) {
      out += '\r\n';
      lineLength = 0;
      if (bytes[i + 1] === 10) i += 1;
      continue;
    }
    if (byte === 10) {
      out += '\r\n';
      lineLength = 0;
      continue;
    }
    const token =
      byte === 9 || (byte >= 32 && byte <= 126 && byte !== 61)
        ? String.fromCharCode(byte)
        : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    const room = token.length > 1 ? 75 : 76;
    if (lineLength + token.length > room) {
      out += '=\r\n';
      lineLength = 0;
    }
    out += token;
    lineLength += token.length;
  }
  return out;
}

function wrapBase64(text) {
  return (String(text).match(/.{1,76}/g) || ['']).join('\r\n');
}

function encodeBase64(text) {
  return wrapBase64(bytesToBase64(new TextEncoder().encode(String(text))));
}

/** RFC 2047 encoded words (=?UTF-8?B?…?= / =?UTF-8?Q?…?=). */
export function decodeEncodedWords(value) {
  return String(value).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (match, charset, encoding, data) => {
    try {
      const bytes =
        encoding.toUpperCase() === 'B'
          ? base64ToBytes(data)
          : decodeQuotedPrintable(data.replace(/_/g, ' '));
      return decodeCharset(bytes, charset);
    } catch {
      return match;
    }
  });
}

function encodeEncodedWords(text) {
  if (!/[^\x20-\x7E]/.test(text)) return text;
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(text))}?=`;
}

function decodeBody(body, encoding, charset) {
  const transfer = String(encoding || '7bit').toLowerCase().trim();
  if (transfer === 'base64') {
    try {
      return decodeCharset(base64ToBytes(body), charset);
    } catch {
      return body;
    }
  }
  if (transfer === 'quoted-printable') {
    return decodeCharset(decodeQuotedPrintable(body), charset);
  }
  return body;
}

function encodeBody(text, encoding) {
  const transfer = String(encoding || '7bit').toLowerCase().trim();
  if (transfer === 'base64') return encodeBase64(text);
  if (transfer === 'quoted-printable') return encodeQuotedPrintable(text);
  return text;
}

function addressNames(value) {
  const names = [];
  for (const part of splitAddressList(decodeEncodedWords(value))) {
    const angle = /^\s*(?:"([^"]*)"|([^<]*?))\s*<[^>]+>\s*$/.exec(part);
    const name = angle ? (angle[1] || angle[2] || '').trim() : '';
    if (name && looksLikeName(name)) names.push(name);
  }
  return names;
}

/** Split an address list on commas that are outside quotes and angle brackets. */
export function splitAddressList(value) {
  const parts = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  for (const ch of String(value || '')) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<') angle += 1;
    else if (ch === '>') angle = Math.max(0, angle - 1);
    if (ch === ',' && !quoted && angle === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Headers are only rewritten when a value actually changes. */
function sanitizeHeaders(headerText, headers, entries) {
  const eol = eolOf(headerText);
  return headers
    .map((header) => {
      if (!header.name) return header.raw;
      const decoded = decodeEncodedWords(header.value);
      const replaced = applyEntriesToText(decoded, entries);
      if (replaced === decoded) return header.raw;
      return `${header.name}: ${encodeEncodedWords(replaced)}`;
    })
    .join(eol);
}

function rebuildPart(headerText, headers, body, entries) {
  const eol = eolOf(headerText);
  const header = sanitizeHeaders(headerText, headers, entries);
  return header ? `${header}${eol}${eol}${body}` : body;
}

function processMultipart(body, boundary, entries, collect) {
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .map((piece, index) => {
      if (index === 0) return piece;
      if (piece.startsWith('--')) return piece; // closing delimiter
      const lead = /^([ \t]*\r?\n)([\s\S]*)$/.exec(piece);
      if (!lead) return piece;
      return lead[1] + processPart(lead[2], entries, collect);
    })
    .join(marker);
}

function processPart(text, entries, collect) {
  const { headerText, body } = splitMessage(text);
  const headers = parseHeaders(headerText, eolOf(text));
  const contentType = parseContentType(getHeader(headers, 'content-type') || 'text/plain');
  const encoding = getHeader(headers, 'content-transfer-encoding') || '7bit';
  const disposition = getHeader(headers, 'content-disposition');

  if (contentType.type.startsWith('multipart/') && contentType.params.boundary) {
    const processed = processMultipart(body, contentType.params.boundary, entries, collect);
    return rebuildPart(headerText, headers, processed, entries);
  }

  const decoded = decodeBody(body, encoding, contentType.params.charset);
  // An attachment body is not decoded/re-encoded here: its headers (including
  // the filename) are still scrubbed, the bytes are left alone.
  const isAttachment = /^\s*attachment/i.test(disposition);
  if (collect && !isAttachment) {
    collect.segments.push(decoded);
    for (const name of ['from', 'to', 'cc', 'bcc', 'reply-to', 'sender', 'subject']) {
      const value = getHeader(headers, name);
      if (value) collect.segments.push(decodeEncodedWords(value), ...addressNames(value));
    }
    if (disposition) collect.segments.push(decodeEncodedWords(disposition));
  }

  if (isAttachment) return rebuildPart(headerText, headers, body, entries);

  const replaced = applyEntriesToText(decoded, entries);
  let encoded = encodeBody(replaced, encoding);
  // A part's body ends with the newline that precedes the next boundary; a
  // base64 re-encode drops it, which would glue the boundary onto the last
  // line and break the message.
  if (/\r?\n$/.test(body) && !/\r?\n$/.test(encoded)) encoded += eolOf(text);
  return rebuildPart(headerText, headers, encoded, entries);
}

export async function detectWithMeta(file) {
  const text = await file.text();
  const collect = { segments: [] };
  processPart(text, [], collect);
  const typedValues = [];
  for (const segment of collect.segments) {
    for (const name of addressNames(segment)) {
      typedValues.push({ original: name, type: 'name', key: 'From', numeric: false });
    }
  }
  console.log(
    `[EML Parser] ${file.name}: ${collect.segments.length} decoded segment(s), ` +
      `${typedValues.length} display name(s).`,
  );
  return { segments: collect.segments, typedValues };
}

export async function detect(file) {
  const { segments } = await detectWithMeta(file);
  return segments;
}

export async function sanitize(file, entries) {
  const text = await file.text();
  const active = entries.filter((entry) => entry && entry.enabled !== false && !entry.numericOnly);
  const output = processPart(text, active, null);
  console.log(`[EML Parser] ${file.name}: ${text.length} -> ${output.length} chars.`);
  return {
    blob: new Blob([output], { type: MIME }),
    name: sanitizedName(file.name, 'eml'),
  };
}
