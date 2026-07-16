import { describe, expect, it } from 'vitest';
import { expenseInputSchema } from './expenses';
import { createGroupSchema } from './groups';
import { currencyCodeSchema } from './money';

describe('currency validation', () => {
  it('normalizes well-formed currency codes', () => {
    expect(currencyCodeSchema.parse(' jpy ')).toBe('JPY');
    expect(createGroupSchema.parse({ name: 'Tokyo' }).defaultCurrency).toBe('CNY');
    expect(createGroupSchema.parse({ name: 'Tokyo', defaultCurrency: 'jpy' }).defaultCurrency).toBe(
      'JPY',
    );
  });

  it.each(['CN', 'USDT', '12A', '人民币'])('rejects malformed code %s', (currency) => {
    expect(currencyCodeSchema.safeParse(currency).success).toBe(false);
  });

  it('allows a non-CNY expense', () => {
    const parsed = expenseInputSchema.parse({
      occurredAt: '2026-07-16T12:00:00.000Z',
      title: 'Dinner',
      currency: 'JPY',
      amount: '1900',
      payerMemberId: 'member-1',
      splitRule: { type: 'EQUAL', memberIds: ['member-1'] },
    });
    expect(parsed.currency).toBe('JPY');
  });
});
