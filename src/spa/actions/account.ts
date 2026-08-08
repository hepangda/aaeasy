import { actionRequest, groupAndListQueryKeys, type ActionResult } from '@/spa/api';

export type AccountActionState = ActionResult;

export async function transferOwnershipAction(input: {
  groupId: string;
  newOwnerUserId: string;
}): Promise<AccountActionState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/ownership`,
    { method: 'PUT', body: JSON.stringify({ newOwnerUserId: input.newOwnerUserId }) },
    [...groupAndListQueryKeys(input.groupId), ['account']],
  );
}

/**
 * Deletes the account. `redirectTo` points at the identity provider's logout
 * endpoint, so the caller navigates the document rather than the router.
 */
export async function deleteAccountAction(): Promise<AccountActionState & { redirectTo?: string }> {
  return actionRequest<AccountActionState & { redirectTo?: string }>('/api/account', {
    method: 'DELETE',
  });
}
