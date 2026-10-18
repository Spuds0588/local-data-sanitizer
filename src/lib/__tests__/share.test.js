import { describe, expect, it } from 'vitest';
import { REPO_URL, pageUrl, copyToClipboard } from '../share.js';

describe('share helpers', () => {
  it('points at the repository', () => {
    expect(REPO_URL).toBe('https://github.com/Spuds0588/local-data-sanitizer');
  });

  it('has no page url outside a browser', () => {
    expect(pageUrl()).toBe('');
  });

  it('reports a failed copy instead of throwing when no clipboard exists', async () => {
    await expect(copyToClipboard('https://example.com')).resolves.toBe(false);
  });
});
