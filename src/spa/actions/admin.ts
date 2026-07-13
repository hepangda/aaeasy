import { actionRequest, formString } from '@/spa/api';

export type AdminActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function addAllowedUsernameAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const username = formString(formData, 'username');
  return actionRequest(`/api/admin/usernames/${encodeURIComponent(username)}`, { method: 'PUT' });
}

export async function deleteAllowedUsernameAction(formData: FormData): Promise<void> {
  const username = formString(formData, 'username');
  await actionRequest(`/api/admin/usernames/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

export async function mergeUsersAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return actionRequest('/api/admin/users/merge', {
    method: 'POST',
    body: JSON.stringify({
      sourceUserId: formString(formData, 'sourceUserId'),
      targetUserId: formString(formData, 'targetUserId'),
    }),
  });
}
