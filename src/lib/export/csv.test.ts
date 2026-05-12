import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv';
import type { ExportPayload } from './data';

const samplePayload: ExportPayload = {
  meta: {
    groupId: 'g1',
    groupName: 'Trip',
    defaultCurrency: 'CNY',
    generatedAt: new Date('2026-01-01T00:00:00Z'),
    locale: 'zh-CN',
  },
  members: [
    { id: 'a', displayName: 'Alice' },
    { id: 'b', displayName: 'Bob' },
  ],
  expenses: [
    {
      date: '2026-01-01',
      title: 'Dinner, soup',
      payer: 'Alice',
      currency: 'CNY',
      amount: 100.5,
      amountText: '¥100.50',
      amountInGroup: 100.5,
      amountInGroupText: '¥100.50',
      shares: { Alice: 50.25, Bob: 50.25 },
      sharesText: { Alice: '50.25', Bob: '50.25' },
      note: 'has "quotes"\nand newline',
      locked: false,
    },
  ],
  summary: [
    {
      member: 'Alice',
      paid: 100.5,
      owed: 50.25,
      net: 50.25,
      paidText: '¥100.50',
      owedText: '¥50.25',
      netText: '¥50.25',
    },
    {
      member: 'Bob',
      paid: 0,
      owed: 50.25,
      net: -50.25,
      paidText: '¥0.00',
      owedText: '¥50.25',
      netText: '-¥50.25',
    },
  ],
  transfers: [{ from: 'Bob', to: 'Alice', amount: 50.25, amountText: '¥50.25' }],
};

describe('buildCsv', () => {
  it('starts with a UTF-8 BOM', () => {
    expect(buildCsv(samplePayload).charCodeAt(0)).toBe(0xfeff);
  });

  it('quotes fields containing comma / quote / newline', () => {
    const csv = buildCsv(samplePayload);
    // Title with comma
    expect(csv).toContain('"Dinner, soup"');
    // Note with quotes (doubled) and newline
    expect(csv).toContain('"has ""quotes""\nand newline"');
  });

  it('formats numbers with two decimal places', () => {
    const csv = buildCsv(samplePayload);
    expect(csv).toContain(',100.50,');
    expect(csv).toContain(',-50.25');
  });

  it('contains all three sections', () => {
    const csv = buildCsv(samplePayload);
    expect(csv).toContain('# 费用明细 / Expenses');
    expect(csv).toContain('# 汇总 / Summary');
    expect(csv).toContain('# 清算指令 / Transfers');
  });

  it('falls back to dash when there are no transfers', () => {
    const csv = buildCsv({ ...samplePayload, transfers: [] });
    expect(csv).toContain('—,—,0.00');
  });
});
