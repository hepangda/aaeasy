import { describe, expect, it } from 'vitest';
import { renderLedgerHtml } from './pdf';

describe('ledger PDF HTML', () => {
  it('escapes user-controlled text before rendering', () => {
    const ledger = {
      group: {
        id: 'group',
        name: '<script>alert(1)</script>',
        defaultCurrency: 'CNY',
        status: 'ACTIVE',
        revision: 1n,
      },
      members: [
        {
          id: 'member',
          displayName: '张三 & Co',
          sortOrder: 0,
          linkedUserId: null,
          linkedUsername: null,
          linkedUserDisplayName: null,
          linkedUserRole: null,
          color: null,
        },
      ],
      expenses: [
        {
          id: 'expense',
          groupId: 'group',
          occurredAt: new Date('2026-07-13T00:00:00.000Z'),
          title: '<img src=x onerror=alert(1)>',
          note: 'A&B',
          currency: 'CNY',
          amountMinor: 100n,
          fxRateToGroupCurrency: '1',
          payerMemberId: 'member',
          splitRule: null,
          splitInputState: null,
          tags: [],
          createdByUserId: null,
          createdByShareLinkId: null,
          createdAt: new Date('2026-07-13T00:00:00.000Z'),
          updatedAt: new Date('2026-07-13T00:00:00.000Z'),
          deletedAt: null,
          lockedBySettlementId: null,
          version: 1,
          splits: [{ id: 'split', expenseId: 'expense', memberId: 'member', shareMinor: 100n }],
        },
      ],
      summary: [
        {
          memberId: 'member',
          paidMinorInGroup: 100n,
          owedMinorInGroup: 100n,
          netMinorInGroup: 0n,
          adjustedNetMinorInGroup: 0n,
        },
      ],
      transfers: [],
      settlementEntries: [],
    } as unknown as Parameters<typeof renderLedgerHtml>[0];

    const html = renderLedgerHtml(ledger, 'zh-CN');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('张三 &amp; Co');
  });
});
