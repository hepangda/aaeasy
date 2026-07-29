// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { Tabs } from './tabs';

function renderTabs(initialHash = '#expenses', alsoInBottomNav = false) {
  return render(
    <IntlProvider locale="en" messages={messages}>
      <MemoryRouter initialEntries={[`/groups/g1${initialHash}`]}>
        <Tabs
          alsoInBottomNav={alsoInBottomNav}
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

  it('keeps the strip visible at every width by default', () => {
    const { container } = renderTabs();
    const strip = container.querySelector('[role="tablist"]')!;
    // (`[&::-webkit-scrollbar]:hidden` also contains "hidden", so match on the
    // responsive utilities specifically.)
    const classes = strip.className.split(/\s+/);
    expect(classes).not.toContain('hidden');
  });

  it('yields to the bottom nav below lg when told it duplicates one', () => {
    const { container } = renderTabs('#expenses', true);
    const strip = container.querySelector('[role="tablist"]')!;
    const classes = strip.className.split(/\s+/);
    // Regression guard: the strip and the mobile bottom nav both drive this
    // hash, so showing both left two conflicting controls on one screen.
    expect(classes).toContain('hidden');
    expect(classes).toContain('lg:flex');
  });

  it('marks the active tab for assistive tech', () => {
    renderTabs('#settlement');
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveTextContent('Settlement');
  });
});
