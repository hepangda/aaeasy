// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { Tabs } from './tabs';

function renderTabs(navigatedElsewhereOnDesktop: boolean) {
  return render(
    <IntlProvider locale="en" messages={messages}>
      <MemoryRouter initialEntries={['/groups/g1#expenses']}>
        <Tabs
          navigatedElsewhereOnDesktop={navigatedElsewhereOnDesktop}
          tabs={[
            { id: 'expenses', label: 'Expenses', content: <p>expenses panel</p> },
            { id: 'settlement', label: 'Settlement', content: <p>settlement panel</p> },
          ]}
        />
      </MemoryRouter>
      ,
    </IntlProvider>,
  );
}

describe('Tabs', () => {
  it('renders the active panel', () => {
    renderTabs(false);
    expect(screen.getByText('expenses panel')).toBeInTheDocument();
  });

  it('hides its strip at lg when navigation lives in the sidebar', () => {
    const { container } = renderTabs(true);
    const strip = container.querySelector('[role="tablist"]')!;
    // Regression guard: the sidebar surfaces these same sections from lg up.
    // Showing both would put two controls on one piece of state.
    expect(strip.className).toContain('lg:hidden');
  });

  it('keeps its strip at every width when nothing else navigates', () => {
    const { container } = renderTabs(false);
    const strip = container.querySelector('[role="tablist"]')!;
    expect(strip.className).not.toContain('lg:hidden');
  });
});
