// Office packages carry a second copy of a person's identity in docProps/:
// `dc:creator` and `cp:lastModifiedBy` on core.xml, `Company` and `Manager` on
// app.xml. Those values are not in the visible document, so a text-only scrub
// leaves the author's name in the file even after every paragraph is clean.

import { applyEntriesToText } from '../text.js';

export const METADATA_PART = /^docProps\/(?:core|app)\.xml$/;

/** core.xml / app.xml contents, if the package has them. */
export async function metadataParts(zip) {
  const parts = [];
  for (const name of Object.keys(zip.files)) {
    if (!METADATA_PART.test(name) || zip.files[name].dir) continue;
    parts.push({ name, xml: await zip.file(name).async('string') });
  }
  return parts;
}

/** Element text with no child markup: the only content docProps parts have. */
const LEAF_TEXT = /<(?<tag>[A-Za-z][\w:.-]*)\b[^>]*>(?<text>[^<]+)<\/\k<tag>\s*>/g;

const NAME_FIELDS = new Set(['creator', 'lastmodifiedby', 'manager']);
const ORG_FIELDS = new Set(['company']);

function localName(tag) {
  return String(tag).split(':').pop().toLowerCase();
}

/**
 * Values in a core.xml/app.xml part, tagged with the kind of value the field
 * holds. `looksLikeName` is applied by the caller because this module does not
 * guess: a creator can be a person, a team or a tool account.
 */
export function metadataValues(xml) {
  const out = [];
  const re = new RegExp(LEAF_TEXT.source, 'g');
  let match;
  while ((match = re.exec(xml)) !== null) {
    const field = localName(match.groups.tag);
    const value = match.groups.text.trim();
    if (!value) continue;
    const type = NAME_FIELDS.has(field) ? 'name' : ORG_FIELDS.has(field) ? 'organization' : null;
    out.push({ field, type, value });
  }
  return out;
}

/** Rewrite only element text, leaving tags, prefixes and attributes alone. */
export function replaceMetadataText(xml, entries, xmlSafe = true) {
  const active = entries.filter((entry) => entry && entry.enabled !== false && !entry.numericOnly);
  const re = new RegExp(LEAF_TEXT.source, 'g');
  return xml.replace(re, (full) => {
    const text = full.slice(full.indexOf('>') + 1, full.lastIndexOf('<'));
    const replaced = applyEntriesToText(text, active, { xmlSafe });
    if (replaced === text) return full;
    return `${full.slice(0, full.indexOf('>') + 1)}${replaced}${full.slice(full.lastIndexOf('<'))}`;
  });
}
