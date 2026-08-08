import type { SplitInputState } from '@aaeasy/core/split-input-state';
import type { SplitRule } from '@aaeasy/core/split-types';
import { actionRequest, ledgerQueryKeys, type ActionResult } from '@/spa/api';

export type ExpenseActionState = ActionResult & { expenseId?: string };

/**
 * What the expense editor submits.
 *
 * Typed on purpose: this used to travel as `FormData`, with `splitRule` and
 * `splitInputState` stringified into hidden inputs and parsed back here — so
 * every field arrived as `string` and a shape change went unnoticed until
 * runtime.
 */
export interface ExpenseInputPayload {
  groupId: string;
  /** Calendar date, `yyyy-mm-dd`; the time of day is not meaningful here. */
  occurredOn: string;
  title: string;
  note: string | null;
  currency: string;
  amount: string;
  payerMemberId: string;
  fxRateOverride?: string;
  splitRule: SplitRule;
  splitInputState: SplitInputState;
  tags?: string[];
}

export interface UpdateExpensePayload extends ExpenseInputPayload {
  expenseId: string;
  expectedVersion: number;
}

function requestBody(input: ExpenseInputPayload) {
  const date = input.occurredOn || new Date().toISOString().slice(0, 10);
  return {
    occurredAt: new Date(`${date}T12:00:00`).toISOString(),
    title: input.title,
    note: input.note || null,
    currency: input.currency || 'CNY',
    amount: input.amount,
    payerMemberId: input.payerMemberId,
    fxRateOverride: input.fxRateOverride || undefined,
    splitRule: input.splitRule,
    splitInputState: input.splitInputState,
    tags: input.tags ?? [],
  };
}

export async function createExpenseAction(
  _previous: ExpenseActionState,
  input: ExpenseInputPayload,
): Promise<ExpenseActionState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/expenses`,
    { method: 'POST', body: JSON.stringify(requestBody(input)) },
    ledgerQueryKeys(input.groupId),
  );
}

export async function updateExpenseAction(
  _previous: ExpenseActionState,
  input: UpdateExpensePayload,
): Promise<ExpenseActionState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/expenses/${encodeURIComponent(input.expenseId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ ...requestBody(input), expectedVersion: input.expectedVersion }),
    },
    ledgerQueryKeys(input.groupId),
  );
}

export async function softDeleteExpenseAction(input: { groupId: string; expenseId: string }) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/expenses/${encodeURIComponent(input.expenseId)}`,
    { method: 'DELETE' },
    ledgerQueryKeys(input.groupId),
  );
}
