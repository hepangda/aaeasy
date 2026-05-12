/**
 * Discriminated union for expense split rules.
 *
 * Persisted to `Expense.splitRule` JSON column. The action layer validates
 * with Zod (`splitRuleSchema`); pure-function consumers in `lib/split` accept
 * an already-validated `SplitRule`.
 *
 * `EQUAL` → split equally across `memberIds` (typically all members).
 * `SUBSET` → split equally across the explicit subset.
 * `WEIGHTED` → split by integer or fractional weights. UI's "shares" mode
 *   produces non-negative integer weights (2:1:1). Decimal weights also OK
 *   (e.g. `1.5`). Sum of weights must be > 0.
 * `EXACT` → exact per-member minor-unit amounts. Sum MUST equal the total.
 *   Produced by the new form UI; replaces EQUAL/SUBSET/WEIGHTED on edit.
 */

import { z } from 'zod';

const memberIdSchema = z.string().min(1).max(40);

export type EqualSplit = { type: 'EQUAL'; memberIds: string[] };
export type SubsetSplit = { type: 'SUBSET'; memberIds: string[] };
export type WeightedSplit = {
  type: 'WEIGHTED';
  weights: { memberId: string; weight: string }[];
  /** When true, the payer absorbs any rounding remainder. Default LRM. */
  roundingToPayer?: boolean;
};
export type ExactSplit = {
  type: 'EXACT';
  /** Each amountMinor is a non-negative integer encoded as a decimal string. */
  amounts: { memberId: string; amountMinor: string }[];
};

export type SplitRule = EqualSplit | SubsetSplit | WeightedSplit | ExactSplit;

export const equalSplitSchema = z.object({
  type: z.literal('EQUAL'),
  memberIds: z.array(memberIdSchema).min(1).max(200),
});

export const subsetSplitSchema = z.object({
  type: z.literal('SUBSET'),
  memberIds: z.array(memberIdSchema).min(1).max(200),
});

export const weightedSplitSchema = z.object({
  type: z.literal('WEIGHTED'),
  weights: z
    .array(
      z.object({
        memberId: memberIdSchema,
        // Accept numeric strings; rejecting NaN / negative happens in lib/split.
        weight: z
          .string()
          .regex(/^\d+(\.\d+)?$/, 'errors.weight_invalid')
          .max(20),
      }),
    )
    .min(1)
    .max(200),
  roundingToPayer: z.boolean().optional(),
});

export const exactSplitSchema = z.object({
  type: z.literal('EXACT'),
  amounts: z
    .array(
      z.object({
        memberId: memberIdSchema,
        amountMinor: z.string().regex(/^\d+$/, 'errors.invalid_amount').max(20),
      }),
    )
    .min(1)
    .max(200),
});

export const splitRuleSchema = z.discriminatedUnion('type', [
  equalSplitSchema,
  subsetSplitSchema,
  weightedSplitSchema,
  exactSplitSchema,
]);

export type SplitRuleInput = z.infer<typeof splitRuleSchema>;
