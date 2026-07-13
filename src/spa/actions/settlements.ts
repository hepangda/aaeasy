import { actionRequest, currentGroupId } from '@/spa/api';

export type SettleActionState = { ok: boolean; error?: string; settlementId?: string };
export type SettlementEntryActionState = { ok: boolean; error?: string };
export type ReopenState = { ok: boolean; error?: string };

export async function settleAction(input: { groupId: string }): Promise<SettleActionState> {
  return actionRequest(`/api/groups/${input.groupId}/settlements`, { method: 'POST' });
}

export async function addSettlementEntryAction(input: {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: string;
  note?: string;
}) {
  return actionRequest(`/api/groups/${input.groupId}/settlement-entries`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteSettlementEntryAction(input: { entryId: string }) {
  const groupId = currentGroupId();
  if (!groupId) return { ok: false, error: 'errors.not_found' };
  return actionRequest(`/api/groups/${groupId}/settlement-entries/${input.entryId}`, {
    method: 'DELETE',
  });
}

export async function reopenSettlementAction(input: {
  settlementId: string;
}): Promise<ReopenState> {
  const groupId = currentGroupId();
  if (!groupId) return { ok: false, error: 'errors.not_found' };
  const result = await actionRequest<ReopenState>(
    `/api/groups/${groupId}/settlements/${input.settlementId}/reopen`,
    { method: 'POST' },
  );
  if (result.ok) window.location.assign(`/groups/${groupId}`);
  return result;
}
