import type { ExportPayload } from './data';

/**
 * Returns a single CSV string with three sections separated by blank lines:
 *   ## Expenses
 *   ## Summary
 *   ## Transfers
 *
 * Headers are bilingual (CN / EN) so the file is readable for both audiences.
 *
 * RFC 4180 quoting: any field containing `,` `"` `\r` or `\n` is wrapped in
 * double quotes and inner quotes are doubled. We prepend a UTF-8 BOM so
 * Excel opens it as UTF-8 instead of guessing.
 */
export function buildCsv(payload: ExportPayload): string {
  const lines: string[] = [];

  // Section: Expenses
  const expenseHeader = [
    '日期 / Date',
    '事由 / Title',
    '垫付人 / Payer',
    '币种 / Currency',
    '金额 / Amount',
    `折合 ${payload.meta.defaultCurrency} / In Group Currency`,
    ...payload.members.map((m) => `${m.displayName} 应摊 / Share`),
    '备注 / Note',
    '已结算 / Locked',
  ];
  lines.push('# 费用明细 / Expenses');
  lines.push(toCsvRow(expenseHeader));
  for (const e of payload.expenses) {
    lines.push(
      toCsvRow([
        e.date,
        e.title,
        e.payer,
        e.currency,
        formatNum(e.amount),
        formatNum(e.amountInGroup),
        ...payload.members.map((m) => formatNum(e.shares[m.displayName] ?? 0)),
        e.note,
        e.locked ? 'Y' : '',
      ]),
    );
  }

  lines.push('');
  lines.push('# 汇总 / Summary');
  lines.push(
    toCsvRow([
      '成员 / Member',
      `实付 ${payload.meta.defaultCurrency} / Paid`,
      `应付 ${payload.meta.defaultCurrency} / Owed`,
      `净额 ${payload.meta.defaultCurrency} / Net`,
    ]),
  );
  for (const s of payload.summary) {
    lines.push(toCsvRow([s.member, formatNum(s.paid), formatNum(s.owed), formatNum(s.net)]));
  }

  lines.push('');
  lines.push('# 清算指令 / Transfers');
  lines.push(
    toCsvRow([
      '付款人 / From',
      '收款人 / To',
      `金额 ${payload.meta.defaultCurrency} / Amount`,
    ]),
  );
  if (payload.transfers.length === 0) {
    lines.push(toCsvRow(['—', '—', '0.00']));
  } else {
    for (const t of payload.transfers) {
      lines.push(toCsvRow([t.from, t.to, formatNum(t.amount)]));
    }
  }

  // BOM helps Excel detect UTF-8.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function toCsvRow(fields: (string | number)[]): string {
  return fields.map(quote).join(',');
}

function quote(v: string | number): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatNum(n: number): string {
  // Two decimal places by default — Excel will respect this as a number.
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}
