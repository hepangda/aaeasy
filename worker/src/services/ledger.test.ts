import { computeLedgerSummary, type LedgerSummary } from '@aaeasy/core';
import { describe, expect, it } from 'vitest';
import { applySettlementEntries, mergeSummary, type ForeignExpense } from './ledger';

type Expense = ForeignExpense;

const MEMBERS = ['a', 'b', 'c'];

/** What `sum()` in Postgres returns for the group-currency slice of a ledger. */
function sqlSums(groupCurrency: string, expenses: readonly Expense[]) {
  const paid = new Map<string, bigint>();
  const owed = new Map<string, bigint>();
  for (const expense of expenses) {
    if (expense.currency !== groupCurrency) continue;
    paid.set(expense.payerMemberId, (paid.get(expense.payerMemberId) ?? 0n) + expense.amountMinor);
    for (const split of expense.splits) {
      owed.set(split.memberId, (owed.get(split.memberId) ?? 0n) + split.shareMinor);
    }
  }
  return { paid, owed };
}

function hybridSummary(groupCurrency: string, expenses: readonly Expense[]): LedgerSummary[] {
  const { paid, owed } = sqlSums(groupCurrency, expenses);
  return mergeSummary({
    memberIds: MEMBERS,
    paidByMember: paid,
    owedByMember: owed,
    foreignSummary: computeLedgerSummary(
      groupCurrency,
      MEMBERS.map((id) => ({ id })),
      expenses.filter((expense) => expense.currency !== groupCurrency),
    ),
  });
}

function reference(groupCurrency: string, expenses: readonly Expense[]): LedgerSummary[] {
  return computeLedgerSummary(
    groupCurrency,
    MEMBERS.map((id) => ({ id })),
    expenses,
  );
}

/** Split `total` the way `computeSplit` does: evenly, remainder to the last. */
function evenSplits(total: bigint, memberIds: readonly string[]) {
  const base = total / BigInt(memberIds.length);
  return memberIds.map((memberId, index) => ({
    memberId,
    shareMinor: index === memberIds.length - 1 ? total - base * BigInt(memberIds.length - 1) : base,
  }));
}

function local(amount: bigint, payer: string, over = MEMBERS): Expense {
  return {
    amountMinor: amount,
    currency: 'CNY',
    fxRateToGroupCurrency: '1',
    payerMemberId: payer,
    splits: evenSplits(amount, over),
  };
}

describe('ledger summary', () => {
  it('matches the row-by-row computation for group-currency expenses', () => {
    // Amounts chosen so several of them do not divide evenly across members.
    const expenses = [
      local(10_000n, 'a'),
      local(3_333n, 'b'),
      local(1n, 'c'),
      local(999_999n, 'a', ['a', 'b']),
      local(0n, 'b'),
    ];

    expect(hybridSummary('CNY', expenses)).toEqual(reference('CNY', expenses));
  });

  it('matches the row-by-row computation when foreign currencies are mixed in', () => {
    const expenses: Expense[] = [
      local(12_345n, 'a'),
      {
        amountMinor: 10_000n,
        currency: 'USD',
        fxRateToGroupCurrency: '7.1234',
        payerMemberId: 'b',
        splits: evenSplits(10_000n, MEMBERS),
      },
      {
        amountMinor: 7n,
        currency: 'JPY',
        fxRateToGroupCurrency: '0.0489',
        payerMemberId: 'c',
        splits: evenSplits(7n, ['b', 'c']),
      },
      local(500n, 'c', ['a', 'c']),
    ];

    expect(hybridSummary('CNY', expenses)).toEqual(reference('CNY', expenses));
  });

  it('keeps every member in the summary, including ones with no activity', () => {
    expect(hybridSummary('CNY', [local(100n, 'a', ['a'])]).map((row) => row.memberId)).toEqual(
      MEMBERS,
    );
  });

  it('moves recorded transfers from the payer to the payee', () => {
    const summary = hybridSummary('CNY', [local(300n, 'a')]);
    const adjusted = applySettlementEntries(summary, [
      { fromMemberId: 'b', toMemberId: 'a', amountMinor: 100n },
    ]);

    const byMember = new Map(adjusted.map((row) => [row.memberId, row]));
    expect(byMember.get('b')?.netMinorInGroup).toBe(-100n);
    expect(byMember.get('b')?.adjustedNetMinorInGroup).toBe(0n);
    expect(byMember.get('a')?.adjustedNetMinorInGroup).toBe(100n);
    expect(byMember.get('c')?.adjustedNetMinorInGroup).toBe(-100n);
  });
});
