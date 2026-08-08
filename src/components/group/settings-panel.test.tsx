// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { SettingsPanel } from './settings-panel';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';

function renderPanel(props: Partial<Parameters<typeof SettingsPanel>[0]> = {}) {
  return render(
    <IntlProvider locale="en" messages={messages}>
      <MemoryRouter>
        <ConfirmDialogProvider>
          <SettingsPanel
            groupId="g1"
            canDeleteGroup
            canTransferOwnership
            canLeave={false}
            canSettle={false}
            isArchived={false}
            ownerCandidates={[]}
            {...props}
          />
        </ConfirmDialogProvider>
      </MemoryRouter>
    </IntlProvider>,
  );
}

describe('SettingsPanel', () => {
  it('keeps the danger zone a sibling of the other settings', () => {
    const { container } = renderPanel();
    const blocks = [...container.firstElementChild!.children];

    // Nesting everything in one card put the red block inside the ownership
    // card, which read as "delete" belonging to "transfer ownership".
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.className).not.toContain('destructive');
    expect(blocks[1]!.className).toContain('destructive');
  });

  it('offers leaving rather than deleting for non-owners', () => {
    const { container } = renderPanel({
      canDeleteGroup: false,
      canTransferOwnership: false,
      canLeave: true,
    });
    const blocks = [...container.firstElementChild!.children];

    // No ownership card without ownership — just the danger zone.
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.textContent).toContain(messages.groups.leave);
  });

  it('does not offer member-only destructive actions to share visitors', () => {
    const { container } = renderPanel({
      canDeleteGroup: false,
      canTransferOwnership: false,
      canLeave: false,
    });
    expect(container.textContent).not.toContain(messages.groups.leave);
    expect(container.querySelector('[class*="destructive"]')).toBeNull();
  });

  it('surfaces reopening only for a settled ledger', () => {
    const { container } = renderPanel({
      isArchived: true,
      canSettle: true,
      settlementId: 's1',
    });
    expect(container.textContent).toContain(messages.expenses.reopen_title);
  });
});
