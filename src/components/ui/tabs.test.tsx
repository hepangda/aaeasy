// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { Tabs } from './tabs';

function renderTabs(initialHash = '#expenses') {
  return render(
    <IntlProvider locale="en" messages={messages}>
      <MemoryRouter initialEntries={[`/groups/g1${initialHash}`]}>
        <Tabs
          tabs={[
            { id: 'expenses', label: 'Expenses', content: <p>expenses panel</p> },
            { id: 'settlement', label: 'Settlement', content: <p>settlement panel</p> },
          ]}
        />
      </MemoryRouter>
    </IntlProvider>,
  );
}

describe('Tabs', () => {
  it('renders the panel named by the URL hash', () => {
    renderTabs('#settlement');
    expect(screen.getByText('settlement panel')).toBeInTheDocument();
  });

  it('keeps the strip visible at every width', () => {
    const { container } = renderTabs();
    const strip = container.querySelector('[role="tablist"]')!;
    // The strip is the sole control for these sections. An earlier revision
    // duplicated it into the global top bar and hid this one at `lg`, which put
    // ledger-scoped navigation into application chrome.
    // (`[&::-webkit-scrollbar]:hidden` also contains "hidden", so match on the
    // responsive utilities specifically.)
    const classes = strip.className.split(/\s+/);
    expect(classes).not.toContain('hidden');
    expect(classes).not.toContain('lg:hidden');
  });

  it('marks the active tab for assistive tech', () => {
    renderTabs('#settlement');
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveTextContent('Settlement');
  });
});
