import { actionRequest, formString } from '@/spa/api';

export type AccountActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function setDisplayNameAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  return actionRequest('/api/account/profile', {
    method: 'PATCH',
    body: JSON.stringify({ displayName: formString(formData, 'displayName') }),
  });
}

export async function transferOwnershipAction(input: {
  groupId: string;
  newOwnerUserId: string;
}): Promise<AccountActionState> {
  return actionRequest(`/api/groups/${encodeURIComponent(input.groupId)}/ownership`, {
    method: 'PUT',
    body: JSON.stringify({ newOwnerUserId: input.newOwnerUserId }),
  });
}

export async function deleteAccountAction(): Promise<never> {
  await actionRequest('/api/account', { method: 'DELETE' });
  window.location.assign('/');
  throw new Error('REDIRECT');
}

export async function listOwnedGroups() {
  return [] as Array<{ id: string; name: string; memberCount: number }>;
}
