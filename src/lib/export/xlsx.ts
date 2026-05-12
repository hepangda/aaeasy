import ExcelJS from 'exceljs';
import type { ExportPayload } from './data';

/**
 * Builds a 3-sheet workbook (Expenses, Summary, Transfers) and returns the
 * raw bytes ready to stream to the client.
 */
export async function buildXlsx(payload: ExportPayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = payload.meta.generatedAt;
  wb.creator = 'AAEasy';

  const moneyFmt = `"${payload.meta.defaultCurrency} "#,##0.00;[Red]"-${payload.meta.defaultCurrency} "#,##0.00`;
  const sourceMoneyFmt = '#,##0.00';

  // ─── Expenses ────────────────────────────────────────────────────────
  const expSheet = wb.addWorksheet('Expenses');
  expSheet.views = [{ state: 'frozen', ySplit: 1 }];
  const memberCols = payload.members.map((m) => `${m.displayName}`);
  expSheet.columns = [
    { header: '日期 / Date', key: 'date', width: 12 },
    { header: '事由 / Title', key: 'title', width: 28 },
    { header: '垫付人 / Payer', key: 'payer', width: 14 },
    { header: '币种 / Cur', key: 'currency', width: 8 },
    { header: '金额 / Amount', key: 'amount', width: 14, style: { numFmt: sourceMoneyFmt } },
    {
      header: `折合 ${payload.meta.defaultCurrency} / Group`,
      key: 'amountInGroup',
      width: 16,
      style: { numFmt: moneyFmt },
    },
    ...memberCols.map((name) => ({
      header: `${name} 应摊`,
      key: `share_${name}`,
      width: 14,
      style: { numFmt: sourceMoneyFmt },
    })),
    { header: '备注 / Note', key: 'note', width: 24 },
    { header: '已结算 / Locked', key: 'locked', width: 10 },
  ];
  for (const e of payload.expenses) {
    const row: Record<string, string | number | boolean> = {
      date: e.date,
      title: e.title,
      payer: e.payer,
      currency: e.currency,
      amount: e.amount,
      amountInGroup: e.amountInGroup,
      note: e.note,
      locked: e.locked,
    };
    for (const m of payload.members) {
      row[`share_${m.displayName}`] = e.shares[m.displayName] ?? 0;
    }
    expSheet.addRow(row);
  }
  expSheet.getRow(1).font = { bold: true };

  // ─── Summary ─────────────────────────────────────────────────────────
  const sumSheet = wb.addWorksheet('Summary');
  sumSheet.views = [{ state: 'frozen', ySplit: 1 }];
  sumSheet.columns = [
    { header: '成员 / Member', key: 'member', width: 18 },
    { header: `实付 / Paid`, key: 'paid', width: 14, style: { numFmt: moneyFmt } },
    { header: `应付 / Owed`, key: 'owed', width: 14, style: { numFmt: moneyFmt } },
    { header: `净额 / Net`, key: 'net', width: 14, style: { numFmt: moneyFmt } },
  ];
  for (const s of payload.summary) {
    sumSheet.addRow(s);
  }
  sumSheet.getRow(1).font = { bold: true };

  // ─── Transfers ───────────────────────────────────────────────────────
  const trSheet = wb.addWorksheet('Transfers');
  trSheet.views = [{ state: 'frozen', ySplit: 1 }];
  trSheet.columns = [
    { header: '付款人 / From', key: 'from', width: 18 },
    { header: '收款人 / To', key: 'to', width: 18 },
    { header: '金额 / Amount', key: 'amount', width: 14, style: { numFmt: moneyFmt } },
  ];
  for (const t of payload.transfers) {
    trSheet.addRow(t);
  }
  trSheet.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
