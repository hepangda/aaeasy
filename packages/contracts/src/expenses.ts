import { z } from 'zod';
import { currencyCodeSchema } from './money';

const splitRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EQUAL'), memberIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('SUBSET'), memberIds: z.array(z.string()).min(1) }),
  z.object({
    type: z.literal('WEIGHTED'),
    weights: z
      .array(
        z.object({
          memberId: z.string().min(1),
          weight: z.string().regex(/^\d+(\.\d+)?$/u),
        }),
      )
      .min(1),
    roundingToPayer: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('EXACT'),
    amounts: z
      .array(
        z.object({
          memberId: z.string().min(1),
          amountMinor: z.string().regex(/^\d+$/u),
        }),
      )
      .min(1),
  }),
]);

export const splitInputStateSchema = z.object({
  rows: z
    .array(
      z.object({
        memberId: z.string().min(1).max(40),
        checked: z.boolean(),
        shares: z.string().max(12),
        extraText: z.string().max(32),
      }),
    )
    .min(1)
    .max(200),
});

export const expenseInputSchema = z.object({
  occurredAt: z.string().datetime(),
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).nullable().optional(),
  currency: currencyCodeSchema,
  amount: z.string().trim().optional(),
  payerMemberId: z.string().min(1),
  fxRateOverride: z.string().trim().optional(),
  splitRule: splitRuleSchema.nullable().optional(),
  splitInputState: splitInputStateSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  isDraft: z.boolean().default(false),
  expectedVersion: z.number().int().positive().optional(),
});

export const updateExpenseInputSchema = expenseInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const fillDraftsSchema = z.object({
  items: z
    .array(
      z.object({
        expenseId: z.string().min(1),
        amount: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(50),
});

export const settlementEntrySchema = z.object({
  fromMemberId: z.string().min(1),
  toMemberId: z.string().min(1),
  amount: z.string().trim().min(1),
  note: z.string().trim().max(200).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
});

export interface GroupEvent {
  revision: string;
  type:
    | 'expense.created'
    | 'expense.updated'
    | 'expense.deleted'
    | 'receipt.changed'
    | 'member.changed'
    | 'group.updated'
    | 'settlement.changed';
  entityId?: string;
  actorId?: string;
  occurredAt: string;
}
