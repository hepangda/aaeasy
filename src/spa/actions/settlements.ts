import { actionRequest, groupQueryKeys, type ActionResult } from '@/spa/api';

export type SettleActionState = ActionResult & { settlementId?: string };
export type SettlementEntryActionState = ActionResult;
export type ReopenState = ActionResult;

export async function settleAction(input: { groupId: string }): Promise<SettleActionState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/settlements`,
    { method: 'POST' },
    groupQueryKeys(input.groupId),
  );
}

export async function addSettlementEntryAction(input: {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: string;
  note?: string;
}) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/settlement-entries`,
    { method: 'POST', body: JSON.stringify(input) },
    groupQueryKeys(input.groupId),
  );
}

// `groupId` is a parameter, not something to recover by parsing
// `window.location.pathname`: that made the action depend on where the user
// happened to be standing, and only worked from one route.
export async function deleteSettlementEntryAction(input: { groupId: string; entryId: string }) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/settlement-entries/${encodeURIComponent(input.entryId)}`,
    { method: 'DELETE' },
    groupQueryKeys(input.groupId),
  );
}

export async function reopenSettlementAction(input: {
  groupId: string;
  settlementId: string;
}): Promise<ReopenState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/settlements/${encodeURIComponent(input.settlementId)}/reopen`,
    { method: 'POST' },
    groupQueryKeys(input.groupId),
  );
}
