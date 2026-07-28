// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntlProvider } from 'use-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import messages from '../../messages/en.json';

const SETTLEMENT_LABEL = messages.settlements.title;
const EXPENSES_LABEL = messages.expenses.title;
import { AppLayout } from './app-layout';
import { ThemeProvider } from '@/components/layout/theme-provider';

const NOW = '2026-01-01T00:00:00.000Z';

function renderLayout(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['session'], {
    user: {
      id: 'u1',
      displayName: 'Zehao',
      username: 'zehao',
      email: 'z@example.com',
      picture: null,
      isSuperAdmin: false,
    },
  });
  qc.setQueryData(['groups'], {
    groups: [
      {
        id: 'g1',
        name: 'Osaka trip',
        status: 'ACTIVE',
        defaultCurrency: 'CNY',
        role: 'OWNER',
        memberCount: 4,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'g2',
        name: 'Flatshare',
        status: 'ACTIVE',
        defaultCurrency: 'CNY',
        role: 'MEMBER',
        memberCount: 3,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    invitations: [],
  });
  qc.setQueryData(['group', 'g1'], {
    group: { id: 'g1', name: 'Osaka trip' },
    access: { kind: 'user' },
  });

  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <IntlProvider locale="en" messages={messages}>
          <MemoryRouter initialEntries={[entry]}>
            <AppLayout />
          </MemoryRouter>
        </IntlProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AppLayout navigation', () => {
  it('uses a top bar rather than a sidebar', () => {
    const { container } = renderLayout('/groups/g1#expenses');
    // The 248px sidebar cost the same width at every viewport while carrying
    // only low-frequency destinations. Regression guard against its return.
    expect(container.querySelector('aside')).toBeNull();
  });

  it('surfaces the current group and its sections together', () => {
    const { container } = renderLayout('/groups/g1#settlement');
    const header = container.querySelector('header.lg\\:block')!;
    const text = header.textContent ?? '';

    // Row one: identity and group choice.
    expect(text).toContain('Osaka trip');
    // Row two: the sections that used to live only behind tabs.
    expect(text).toContain(EXPENSES_LABEL);
    expect(text).toContain(SETTLEMENT_LABEL);
  });

  it('marks the active section from the URL hash', () => {
    const { container } = renderLayout('/groups/g1#settlement');
    const header = container.querySelector('header.lg\\:block')!;
    const current = within(header as HTMLElement).getByRole('link', { current: 'page' });
    expect(current).toHaveTextContent(SETTLEMENT_LABEL);
  });

  it('omits group sections outside a group', () => {
    const { container } = renderLayout('/groups');
    const header = container.querySelector('header.lg\\:block')!;
    expect(header.textContent).not.toContain(SETTLEMENT_LABEL);
  });

  it('keeps content free of any sidebar offset', () => {
    renderLayout('/groups/g1#expenses');
    const main = screen.getByRole('main');
    expect(main.className).not.toContain('pl-[15.5rem]');
  });
});
