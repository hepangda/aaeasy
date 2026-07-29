// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { MembersPanel } from './members-panel';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';
import type { MemberLite } from './types';

const OWNER: MemberLite = {
  id: 'm1',
  displayName: 'Staging Owner',
  sortOrder: 0,
  linkedUserId: 'u1',
  linkedUsername: 'owner',
  linkedUserDisplayName: 'Staging Owner',
  linkedUserRole: 'OWNER',
  color: null,
};

const UNLINKED: MemberLite = {
  id: 'm2',
  displayName: 'AAEasy-QA1',
  sortOrder: 1,
  linkedUserId: null,
  linkedUsername: null,
  linkedUserDisplayName: null,
  linkedUserRole: null,
  color: null,
};

function renderPanel(members: MemberLite[]) {
  return render(
    <IntlProvider locale="en" messages={messages}>
      <MemoryRouter>
        <ConfirmDialogProvider>
          <MembersPanel
            groupId="g1"
            members={members}
            membersPage={{ slice: members, page: 1, totalPages: 1 }}
            isOwner
            canManage
            existingShareLinks={[]}
            pendingInvitations={[]}
            baseUrl="https://example.test"
          />
        </ConfirmDialogProvider>
      </MemoryRouter>
    </IntlProvider>,
  );
}

describe('MembersPanel', () => {
  it('gives every row the same height regardless of its actions', () => {
    const { container } = renderPanel([OWNER, UNLINKED]);
    const rows = [...container.querySelectorAll('li')];

    // The owner row's only trailing element is a 24px role badge, while other
    // rows carry 44px icon buttons. Without a floor the two rendered at
    // visibly different heights.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className).toContain('min-h-16');
    }
  });

  it('reserves the action area even when a row has no buttons', () => {
    const { container } = renderPanel([OWNER]);
    const actions = container.querySelector('li > div > span:last-child')!;
    expect(actions.className).toContain('min-h-11');
  });
});
