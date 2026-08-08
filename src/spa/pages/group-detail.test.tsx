// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { IntlProvider } from 'use-intl';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import messages from '../../../messages/en.json';
import { GroupDetailPage } from './group-detail';

vi.mock('@/components/group/group-live-refresher', () => ({
  GroupLiveRefresher: () => null,
}));

function renderPage(accessKind: 'user' | 'share') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['group', 'g1'], {
    group: {
      id: 'g1',
      name: 'Osaka trip',
      defaultCurrency: 'CNY',
      status: 'ACTIVE',
      revision: '1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    },
    access: {
      kind: accessKind,
      userId: accessKind === 'user' ? 'u1' : null,
      role: accessKind === 'user' ? 'MEMBER' : null,
      scope: accessKind === 'share' ? 'READ' : null,
      linkedMemberId: null,
      bypass: null,
      canWriteExpense: false,
      canManageMembers: false,
      canSettle: false,
      canDeleteGroup: false,
    },
    members: [],
    shareLinks: [],
    pendingInvitations: [],
    activeSettlementId: null,
  });
  queryClient.setQueryData(['ledger', 'g1', 1], {
    group: {
      id: 'g1',
      name: 'Osaka trip',
      defaultCurrency: 'CNY',
      status: 'ACTIVE',
      revision: '1',
    },
    members: [],
    expenses: [],
    expensePage: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
    openExpenseCount: 0,
    summary: [],
    transfers: [],
    settlementEntries: [],
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={messages}>
        <MemoryRouter initialEntries={['/groups/g1']}>
          <Routes>
            <Route path="/groups/:groupId" element={<GroupDetailPage />} />
          </Routes>
        </MemoryRouter>
      </IntlProvider>
    </QueryClientProvider>,
  );
}

describe('GroupDetailPage navigation', () => {
  it('keeps its mobile tab strip for share visitors without member navigation', () => {
    const { container } = renderPage('share');
    const tabList = container.querySelector('[role="tablist"]')!;
    expect(tabList.className.split(/\s+/u)).toContain('flex');
    expect(tabList.className.split(/\s+/u)).not.toContain('hidden');
    expect(tabList.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(tabList.textContent).not.toContain(messages.groups.settings_short);
  });

  it('yields its mobile tab strip to member navigation for signed-in members', () => {
    const { container } = renderPage('user');
    const classes = container.querySelector('[role="tablist"]')!.className.split(/\s+/u);
    expect(classes).toContain('hidden');
    expect(classes).toContain('lg:flex');
  });
});
