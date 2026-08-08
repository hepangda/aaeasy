// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
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

function renderLayout(
  entry: string,
  options: {
    accessKind?: 'user' | 'share';
    canWriteExpense?: boolean;
    status?: 'ACTIVE' | 'ARCHIVED';
  } = {},
) {
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
    group: { id: 'g1', name: 'Osaka trip', status: options.status ?? 'ACTIVE' },
    access: {
      kind: options.accessKind ?? 'user',
      canWriteExpense: options.canWriteExpense ?? true,
    },
  });
  qc.setQueryData(['ledger', 'g1', 1], {});

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

  it('names the current ledger so the switcher has context', () => {
    const { container } = renderLayout('/groups/g1#settlement');
    const header = container.querySelector('header.lg\\:block')!;
    expect(header.textContent).toContain('Osaka trip');
  });

  it('keeps ledger-scoped sections out of application chrome', () => {
    const { container } = renderLayout('/groups/g1#settlement');
    const header = container.querySelector('header.lg\\:block')!;
    const text = header.textContent ?? '';

    // The top bar answers "who am I / which ledger". Which *part* of a ledger
    // you're viewing belongs to that ledger's own page header — putting it here
    // blurred the scope and forced the page's tab strip to be hidden.
    expect(text).not.toContain(SETTLEMENT_LABEL);
    expect(text).not.toContain(EXPENSES_LABEL);
  });

  it('offers every ledger section in the bottom nav', () => {
    const { container } = renderLayout('/groups/g1#members');
    const nav = container.querySelector('nav.lg\\:hidden')!;
    const text = nav.textContent ?? '';

    // The bottom nav is the sole section control below `lg`, so it has to carry
    // all four — leaving one out would strand it behind no affordance at all.
    for (const label of [
      messages.expenses.title,
      messages.settlements.title,
      messages.members.title,
      messages.groups.settings_short,
    ]) {
      expect(text).toContain(label);
    }
  });

  it('centres the compose action in the bottom nav', () => {
    const { container } = renderLayout('/groups/g1#expenses');
    const items = [...container.querySelector('nav.lg\\:hidden')!.firstElementChild!.children];

    // Adding an expense is why this app exists, so it sits where a thumb rests
    // — two sections either side of it rather than pushed off to one edge.
    expect(items).toHaveLength(5);
    expect(items[2]!.textContent).toContain(messages.expenses.add);
  });

  it('does not render member navigation for share access', () => {
    const { container } = renderLayout('/groups/g1#expenses', { accessKind: 'share' });
    expect(container.querySelector('nav.lg\\:hidden')).toBeNull();
  });

  it('omits the compose action for read-only members', () => {
    const { container } = renderLayout('/groups/g1#expenses', { canWriteExpense: false });
    const nav = container.querySelector('nav.lg\\:hidden')!;
    expect(nav.textContent).not.toContain(messages.expenses.add);
    expect(nav.firstElementChild!.children).toHaveLength(4);
  });

  it('omits the compose action for archived ledgers', () => {
    const { container } = renderLayout('/groups/g1#expenses', { status: 'ARCHIVED' });
    const nav = container.querySelector('nav.lg\\:hidden')!;
    expect(nav.textContent).not.toContain(messages.expenses.add);
    expect(nav.firstElementChild!.children).toHaveLength(4);
  });

  it('keeps content free of any sidebar offset', () => {
    renderLayout('/groups/g1#expenses');
    const main = screen.getByRole('main');
    expect(main.className).not.toContain('pl-[15.5rem]');
  });
});
