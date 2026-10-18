// Sharing helpers. The app is a static page, so a link is all it takes.

export const REPO_URL = 'https://github.com/Spuds0588/local-data-sanitizer';

export const SHARE_TEXT =
  'Scrub-Hub redacts PII and secrets from DOCX, XLSX, CSV, JSON and PDF files before you feed them to an LLM — entirely in the browser.';

/** Shareable address of the current page, without hash or query noise. */
export function pageUrl() {
  if (typeof window === 'undefined' || !window.location) return '';
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`;
}

/**
 * Copy text, falling back to the selection trick on insecure origins where the
 * async clipboard API is unavailable. Returns whether the copy succeeded.
 */
export async function copyToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
