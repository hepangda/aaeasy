import { actionRequest, groupQueryKeys, type ActionResult } from '@/spa/api';

export type ShareActionState = ActionResult & { token?: string };
export type UnlockState = ActionResult & {
  needsClaim?: { memberId: string; memberName: string };
  /** Where the caller should navigate on success. */
  redirectTo?: string;
};

/** `'READ_ONLY'`, or a lifetime in hours. */
export type ShareLinkExpiry = 'READ_ONLY' | string;

export async function createMemberShareLinkAction(
  _previous: ShareActionState,
  input: {
    groupId: string;
    memberId: string;
    expires: ShareLinkExpiry;
    assignedRole: string;
    label?: string;
  },
): Promise<ShareActionState> {
  const readOnly = input.expires === 'READ_ONLY';
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/share-links`,
    {
      method: 'POST',
      body: JSON.stringify({
        memberId: input.memberId,
        scope: readOnly ? 'READ' : 'WRITE',
        assignedRole: input.assignedRole || 'MEMBER',
        label: input.label || undefined,
        expiresAt: readOnly
          ? null
          : new Date(Date.now() + Number(input.expires) * 60 * 60 * 1000).toISOString(),
      }),
    },
    groupQueryKeys(input.groupId),
  );
}

export async function createGroupShareLinkAction(
  _previous: ShareActionState,
  input: { groupId: string; label?: string },
): Promise<ShareActionState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/share-links`,
    {
      method: 'POST',
      body: JSON.stringify({
        memberId: null,
        scope: 'READ',
        assignedRole: null,
        label: input.label || undefined,
      }),
    },
    groupQueryKeys(input.groupId),
  );
}

export async function revokeShareLinkAction(input: { groupId: string; shareLinkId: string }) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/share-links/${encodeURIComponent(input.shareLinkId)}`,
    { method: 'DELETE' },
    groupQueryKeys(input.groupId),
  );
}

export async function unlockShareAction(
  _previous: UnlockState,
  input: { token: string; claimMemberId?: string },
): Promise<UnlockState> {
  return actionRequest<UnlockState>('/api/share/unlock', {
    method: 'POST',
    body: JSON.stringify({ token: input.token, claimMemberId: input.claimMemberId || undefined }),
  });
}
