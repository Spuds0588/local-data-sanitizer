import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import Header from '../Header.jsx';
import FilesStep from '../FilesStep.jsx';
import RulesStep from '../RulesStep.jsx';
import ReviewStep from '../ReviewStep.jsx';
import { DEFAULT_CONFIG } from '../../lib/rules.js';

const noop = () => {};

// React SSR separates adjacent text nodes with comment markers; strip them so
// assertions read like the text a user actually sees.
const render = (el) => renderToString(el).replaceAll('<!-- -->', '');

describe('Header', () => {
  it('offers a restart control only once there is a session to clear', () => {
    const idle = render(<Header onRestart={noop} canRestart={false} />);
    expect(idle).toContain('Start over');
    expect(idle).toContain('disabled=""');

    const active = render(<Header onRestart={noop} canRestart />);
    expect(active).toContain('Start over');
    expect(active).not.toContain('disabled=""');
  });
});

describe('FilesStep', () => {
  it('lists files with sizes and a remove control', () => {
    const html = render(
      <FilesStep
        files={[{ id: 'f1', name: 'payroll.xlsx', size: 2048 }]}
        errors={['"big.pdf" is over the 25 MB limit.']}
        onFiles={noop}
        onRemove={noop}
        onClear={noop}
      />,
    );
    expect(html).toContain('payroll.xlsx');
    expect(html).toContain('2.0 KB');
    expect(html).toContain('over the 25 MB limit');
    expect(html).toContain('aria-label="Remove payroll.xlsx"');
    expect(html).toContain('1 file<');
  });

  it('hides the file list when nothing is loaded', () => {
    const html = render(<FilesStep files={[]} errors={[]} onFiles={noop} onRemove={noop} onClear={noop} />);
    expect(html).not.toContain('Clear');
  });
});

describe('RulesStep', () => {
  it('renders every rule as a checked or unchecked box', () => {
    const html = render(
      <RulesStep
        config={DEFAULT_CONFIG}
        updateConfig={noop}
        addKeyword={noop}
        removeKeyword={noop}
        exportRules={noop}
        importRules={noop}
      />,
    );
    expect(html).toContain('Email addresses');
    expect(html).toContain('Credit card numbers');
    expect(html).toContain('Card fragments (masked / last four)');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Custom keywords');
    expect(html).toContain('Import rules.json');
  });

  it('renders custom keywords as removable chips', () => {
    const html = render(
      <RulesStep
        config={{ ...DEFAULT_CONFIG, customKeywords: ['Project Phoenix'] }}
        updateConfig={noop}
        addKeyword={noop}
        removeKeyword={noop}
        exportRules={noop}
        importRules={noop}
      />,
    );
    expect(html).toContain('Project Phoenix');
    expect(html).toContain('aria-label="Remove Project Phoenix"');
  });
});

describe('ReviewStep', () => {
  const entries = [
    { id: 'e1', type: 'email', original: 'ada@corp.com', fakeValue: 'x@fake.dev', count: 2, context: 'to ada@corp.com', enabled: true },
    { id: 'e2', type: 'ssn', original: '123-45-6789', fakeValue: '000-00-0000', count: 1, context: 'ssn 123-45-6789', enabled: false },
  ];
  const props = {
    entries,
    enabledCount: 1,
    status: 'ready',
    downloads: [],
    onToggle: noop,
    onSetFake: noop,
    onSetAll: noop,
    onSanitize: noop,
  };

  it('shows flagged items with editable replacements', () => {
    const html = render(<ReviewStep {...props} />);
    expect(html).toContain('ada@corp.com');
    expect(html).toContain('value="x@fake.dev"');
    expect(html).toContain('123-45-6789');
    expect(html).toContain('2</span> flagged');
    // Only the unchecked row is struck out.
    expect(html.match(/line-through/g)).toHaveLength(1);
    expect(html).toContain('text-neutral-400 line-through">123-45-6789');
  });

  it('disables sanitize while nothing is selected', () => {
    const html = render(<ReviewStep {...props} enabledCount={0} />);
    expect(html).toContain('Sanitize &amp; download');
    expect(html).toContain('disabled');
  });

  it('reports the last download batch', () => {
    const html = render(<ReviewStep {...props} downloads={[{ name: 'payroll.sanitized.xlsx', size: 123 }]} />);
    expect(html).toContain('payroll.sanitized.xlsx');
    expect(html).toContain('(123 bytes)');
    expect(html).toContain('Downloaded 1 file');
  });

  it('explains an empty result set', () => {
    const html = render(<ReviewStep {...props} entries={[]} enabledCount={0} />);
    expect(html).toContain('Nothing flagged yet');
  });
});
