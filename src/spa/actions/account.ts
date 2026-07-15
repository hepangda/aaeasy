import { actionRequest } from '@/spa/api';

export type AccountActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function transferOwnershipAction(input: {
  groupId: string;
  newOwnerUserId: string;
}): Promise<AccountActionState> {
  return actionRequest(`/api/groups/${encodeURIComponent(input.groupId)}/ownership`, {
    method: 'PUT',
    body: JSON.stringify({ newOwnerUserId: input.newOwnerUserId }),
  });
}

export async function deleteAccountAction(): Promise<AccountActionState> {
  const result = await actionRequest<AccountActionState & { redirectTo?: string }>('/api/account', {
    method: 'DELETE',
  });
  if (result.ok) window.location.assign(result.redirectTo ?? '/');
  return result;
}

export async function listOwnedGroups() {
  return [] as Array<{ id: string; name: string; memberCount: number }>;
}
