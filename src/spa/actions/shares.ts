import { actionRequest, formString } from '@/spa/api';

export type ShareActionState = { ok: boolean; error?: string; token?: string };
export type UnlockState = {
  ok: boolean;
  error?: string;
  needsClaim?: { memberId: string; memberName: string };
};

export async function createMemberShareLinkAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  const groupId = formString(formData, 'groupId');
  const expires = formString(formData, 'expires');
  const readOnly = expires === 'READ_ONLY';
  return actionRequest(`/api/groups/${groupId}/share-links`, {
    method: 'POST',
    body: JSON.stringify({
      memberId: formString(formData, 'memberId'),
      scope: readOnly ? 'READ' : 'WRITE',
      assignedRole: formString(formData, 'assignedRole') || 'MEMBER',
      label: formString(formData, 'label') || undefined,
      expiresAt: readOnly
        ? null
        : new Date(Date.now() + Number(expires) * 60 * 60 * 1000).toISOString(),
    }),
  });
}

export async function createGroupShareLinkAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  const groupId = formString(formData, 'groupId');
  return actionRequest(`/api/groups/${groupId}/share-links`, {
    method: 'POST',
    body: JSON.stringify({
      memberId: null,
      scope: 'READ',
      assignedRole: null,
      label: formString(formData, 'label') || undefined,
    }),
  });
}

export async function revokeShareLinkAction(input: { groupId: string; shareLinkId: string }) {
  return actionRequest(`/api/groups/${input.groupId}/share-links/${input.shareLinkId}`, {
    method: 'DELETE',
  });
}

export async function unlockShareAction(
  _previous: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const result = await actionRequest<UnlockState & { redirectTo?: string }>('/api/share/unlock', {
    method: 'POST',
    body: JSON.stringify({
      token: formString(formData, 'token'),
      claimMemberId: formString(formData, 'claimMemberId') || undefined,
    }),
  });
  if (result.ok && result.redirectTo) window.location.assign(result.redirectTo);
  return result;
}
