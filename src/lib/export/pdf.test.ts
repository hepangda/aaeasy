import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf';
import type { ExportPayload } from './data';

describe('buildPdf', () => {
  it('embeds the bundled Chinese font for CJK exports', async () => {
    const payload: ExportPayload = {
      meta: {
        groupId: 'group-1',
        groupName: '中文测试群组',
        defaultCurrency: 'CNY',
        generatedAt: new Date('2026-05-12T08:00:00.000Z'),
        locale: 'zh-CN',
      },
      members: [
        { id: 'member-1', displayName: '张三' },
        { id: 'member-2', displayName: '李四' },
      ],
      expenses: [
        {
          date: '2026-05-12',
          title: '午餐和咖啡',
          payer: '张三',
          currency: 'CNY',
          amount: 123.45,
          amountText: '¥123.45',
          amountInGroup: 123.45,
          amountInGroupText: '¥123.45',
          shares: { 张三: 61.72, 李四: 61.73 },
          sharesText: { 张三: '¥61.72', 李四: '¥61.73' },
          note: '',
          locked: false,
        },
      ],
      summary: [
        {
          member: '张三',
          paid: 123.45,
          owed: 61.72,
          net: 61.73,
          paidText: '¥123.45',
          owedText: '¥61.72',
          netText: '¥61.73',
        },
        {
          member: '李四',
          paid: 0,
          owed: 61.73,
          net: -61.73,
          paidText: '¥0.00',
          owedText: '¥61.73',
          netText: '-¥61.73',
        },
      ],
      transfers: [{ from: '李四', to: '张三', amount: 61.73, amountText: '¥61.73' }],
    };

    const pdf = await buildPdf(payload);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('NotoSansSC');
  });
});
