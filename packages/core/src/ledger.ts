import Decimal from 'decimal.js';
import { convertMinor } from './money';

export interface LedgerMember {
  id: string;
}

export interface LedgerExpense {
  amountMinor: bigint;
  currency: string;
  fxRateToGroupCurrency: Decimal | string;
  payerMemberId: string;
  splits: Array<{ memberId: string; shareMinor: bigint }>;
}

export interface LedgerSummary {
  memberId: string;
  paidMinorInGroup: bigint;
  owedMinorInGroup: bigint;
  netMinorInGroup: bigint;
}

export function computeLedgerSummary(
  groupCurrency: string,
  members: readonly LedgerMember[],
  expenses: readonly LedgerExpense[],
): LedgerSummary[] {
  const paid = new Map<string, bigint>(members.map((member) => [member.id, 0n]));
  const owed = new Map<string, bigint>(members.map((member) => [member.id, 0n]));

  for (const expense of expenses) {
    const rate =
      expense.fxRateToGroupCurrency instanceof Decimal
        ? expense.fxRateToGroupCurrency
        : new Decimal(expense.fxRateToGroupCurrency);
    const amountInGroup = convertMinor(expense.amountMinor, expense.currency, groupCurrency, rate);
    paid.set(expense.payerMemberId, (paid.get(expense.payerMemberId) ?? 0n) + amountInGroup);
    if (amountInGroup === 0n || expense.amountMinor === 0n) continue;

    let assigned = 0n;
    const ordered = [...expense.splits].sort((left, right) =>
      left.memberId.localeCompare(right.memberId),
    );
    for (const [index, split] of ordered.entries()) {
      const isLast = index === ordered.length - 1;
      const converted = isLast
        ? amountInGroup - assigned
        : convertMinor(split.shareMinor, expense.currency, groupCurrency, rate);
      if (!isLast) assigned += converted;
      owed.set(split.memberId, (owed.get(split.memberId) ?? 0n) + converted);
    }
  }

  return members.map((member) => {
    const memberPaid = paid.get(member.id) ?? 0n;
    const memberOwed = owed.get(member.id) ?? 0n;
    return {
      memberId: member.id,
      paidMinorInGroup: memberPaid,
      owedMinorInGroup: memberOwed,
      netMinorInGroup: memberPaid - memberOwed,
    };
  });
}
