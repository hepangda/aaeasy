import type { SplitInputState } from '@/lib/split/input-state';
import type { SplitRule } from '@/lib/split/types';
import { actionRequest, formString } from '@/spa/api';

export type ExpenseActionState = {
  ok: boolean;
  error?: string;
  expenseId?: string;
};

function body(formData: FormData) {
  const date = formString(formData, 'occurredAt');
  const splitRule = formString(formData, 'splitRule');
  const splitInputState = formString(formData, 'splitInputState');
  return {
    occurredAt: new Date(`${date || new Date().toISOString().slice(0, 10)}T12:00:00`).toISOString(),
    title: formString(formData, 'title'),
    note: formString(formData, 'note') || null,
    currency: formString(formData, 'currency') || 'CNY',
    amount: formString(formData, 'amount') || undefined,
    payerMemberId: formString(formData, 'payerMemberId'),
    fxRateOverride: formString(formData, 'fxRateOverride') || undefined,
    splitRule: splitRule ? (JSON.parse(splitRule) as SplitRule) : null,
    splitInputState: splitInputState ? (JSON.parse(splitInputState) as SplitInputState) : null,
    tags: formString(formData, 'tags')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    isDraft: formString(formData, 'isDraft') === 'true',
  };
}

export async function createExpenseAction(
  _previous: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const groupId = formString(formData, 'groupId');
  return actionRequest(`/api/groups/${groupId}/expenses`, {
    method: 'POST',
    body: JSON.stringify(body(formData)),
  });
}

export async function updateExpenseAction(
  _previous: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const groupId = formString(formData, 'groupId');
  const expenseId = formString(formData, 'expenseId');
  return actionRequest(`/api/groups/${groupId}/expenses/${expenseId}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...body(formData),
      expectedVersion: Number(formString(formData, 'expectedVersion')),
    }),
  });
}

export async function softDeleteExpenseAction(input: { groupId: string; expenseId: string }) {
  return actionRequest(`/api/groups/${input.groupId}/expenses/${input.expenseId}`, {
    method: 'DELETE',
  });
}

export async function fillDraftsAction(input: {
  groupId: string;
  items: Array<{ expenseId: string; amount: string }>;
}) {
  return actionRequest<{
    ok: boolean;
    error?: string;
    filled?: string[];
    failed?: Array<{ expenseId: string; error: string }>;
  }>(`/api/groups/${input.groupId}/expenses/fill-drafts`, {
    method: 'POST',
    body: JSON.stringify({ items: input.items }),
  });
}
