import { convertMinor, formatMinor } from '@aaeasy/core';
import type { loadLedger } from '../services/ledger';

type Ledger = NonNullable<Awaited<ReturnType<typeof loadLedger>>>;

function protectSpreadsheetFormula(value: string): string {
  const trimmed = value.trimStart();
  if (!/^[=+@-]/u.test(trimmed) || /^-?\d+(?:\.\d+)?$/u.test(trimmed)) return value;
  return `'${value}`;
}

export function encodeCsvCell(value: string): string {
  const protectedValue = protectSpreadsheetFormula(value);
  return /[",\r\n]/u.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

function row(values: string[]): string {
  return values.map(encodeCsvCell).join(',');
}

export function createLedgerCsv(ledger: Ledger): string {
  const lines: string[] = [];
  const memberById = new Map(ledger.members.map((member) => [member.id, member]));
  const currency = ledger.group.defaultCurrency;
  const expenses = ledger.expenses;

  lines.push('# 费用明细 / Expenses');
  lines.push(
    row([
      '日期 / Date',
      '事由 / Title',
      '垫付人 / Payer',
      '币种 / Currency',
      '金额 / Amount',
      `折合 ${currency} / In Group Currency`,
      ...ledger.members.map((member) => `${member.displayName} 应摊 / Share`),
      '备注 / Note',
      '已结算 / Locked',
    ]),
  );
  for (const expense of expenses) {
    const amountInGroup = convertMinor(
      expense.amountMinor,
      expense.currency,
      currency,
      expense.fxRateToGroupCurrency,
    );
    const shares = new Map(expense.splits.map((split) => [split.memberId, split.shareMinor]));
    lines.push(
      row([
        expense.occurredAt.toISOString().slice(0, 10),
        expense.title,
        memberById.get(expense.payerMemberId)?.displayName ?? '?',
        expense.currency,
        formatMinor(expense.amountMinor, expense.currency),
        formatMinor(amountInGroup, currency),
        ...ledger.members.map((member) =>
          formatMinor(shares.get(member.id) ?? 0n, expense.currency),
        ),
        expense.note ?? '',
        expense.lockedBySettlementId ? 'Y' : '',
      ]),
    );
  }

  lines.push('', '# 汇总 / Summary');
  lines.push(
    row([
      '成员 / Member',
      `实付 ${currency} / Paid`,
      `应付 ${currency} / Owed`,
      `净额 ${currency} / Net`,
      `结算后净额 ${currency} / Adjusted net`,
    ]),
  );
  for (const summary of ledger.summary) {
    lines.push(
      row([
        memberById.get(summary.memberId)?.displayName ?? '?',
        formatMinor(summary.paidMinorInGroup, currency),
        formatMinor(summary.owedMinorInGroup, currency),
        formatMinor(summary.netMinorInGroup, currency),
        formatMinor(summary.adjustedNetMinorInGroup, currency),
      ]),
    );
  }

  lines.push('', '# 清算指令 / Transfers');
  lines.push(row(['付款人 / From', '收款人 / To', `金额 ${currency} / Amount`]));
  if (ledger.transfers.length === 0) {
    lines.push(row(['—', '—', formatMinor(0n, currency)]));
  } else {
    for (const transfer of ledger.transfers) {
      lines.push(
        row([
          memberById.get(transfer.from)?.displayName ?? '?',
          memberById.get(transfer.to)?.displayName ?? '?',
          formatMinor(transfer.amountMinor, currency),
        ]),
      );
    }
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
