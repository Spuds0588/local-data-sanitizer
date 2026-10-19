import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from './App.jsx';

describe('App shell', () => {
  const html = renderToString(<App />);

  it('renders the header and the local-only promise', () => {
    expect(html).toContain('Scrub-Hub');
    expect(html).toContain('Runs entirely in this browser');
    expect(html).toContain('Nothing is uploaded');
    expect(html).toContain('Amounts are jiggled by up to ±20%');
  });

  it('renders exactly the three wizard steps', () => {
    for (const label of ['Files', 'Rules', 'Review']) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('exposes a start-over control that waits for a loaded file', () => {
    expect(html).toContain('Start over');
    expect(html).toContain('disabled:cursor-not-allowed');
  });

  it('opens on the upload step', () => {
    expect(html).toContain('Drop files or click to browse');
    expect(html).toContain('MB each');
  });

  it('gates the review step until a file is loaded', () => {
    expect(html).toContain('disabled');
    expect(html).toContain('aria-current="step"');
  });
});
