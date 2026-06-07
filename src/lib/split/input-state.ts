/**
 * Raw per-row state of the split editor in the expense form.
 *
 * This is NOT the authoritative split — `SplitRule` (an EXACT rule) is. This
 * is the *form input* the user last typed, persisted to
 * `Expense.splitInputState` so the edit page can restore the exact controls
 * (who's checked, each member's share count, each member's extra amount)
 * instead of reverse-engineering them from the computed amounts.
 *
 * `extraText` is kept as the free-form string the user typed (may be empty,
 * may be negative) so the round-trip is loss-free; the form re-parses it.
 */

import { z } from 'zod';

export interface SplitInputRow {
  memberId: string;
  checked: boolean;
  /** Integer share count as a string. '' is treated as 0. */
  shares: string;
  /** Extra amount in MAJOR units, free-form (may be '' or negative). */
  extraText: string;
}

export interface SplitInputState {
  rows: SplitInputRow[];
}

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
