import { actionRequest, groupAndListQueryKeys, groupQueryKeys, type ActionResult } from '@/spa/api';

export type ActionState = ActionResult;

export type MemberChip = { kind: 'name'; text: string } | { kind: 'mention'; username: string };

export type CreateGroupState = ActionState & {
  groupId?: string;
  unresolvedMention?: boolean;
  /** Where the caller should navigate on success. */
  redirectTo?: string;
};

export async function createGroupAction(
  _previous: CreateGroupState,
  input: { name: string; defaultCurrency: string; members: MemberChip[] },
): Promise<CreateGroupState> {
  const result = await actionRequest<CreateGroupState>(
    '/api/groups',
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        defaultCurrency: input.defaultCurrency || 'CNY',
        members: input.members,
      }),
    },
    [['groups'], ['account']],
  );
  if (!result.ok || !result.groupId) return result;
  // The caller navigates. Doing it here with `location.assign` reloaded the
  // whole SPA and threw away the query cache we had just refreshed.
  return {
    ...result,
    redirectTo: `/groups/${result.groupId}${
      result.unresolvedMention ? '?notice=unresolved_mention' : ''
    }`,
  };
}

export async function renameGroupAction(input: {
  groupId: string;
  name: string;
}): Promise<ActionState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}`,
    { method: 'PATCH', body: JSON.stringify({ name: input.name }) },
    groupAndListQueryKeys(input.groupId),
  );
}

export async function addMemberAction(
  _previous: ActionState,
  input: { groupId: string; displayName: string },
): Promise<ActionState> {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/members`,
    { method: 'POST', body: JSON.stringify({ displayName: input.displayName }) },
    groupQueryKeys(input.groupId),
  );
}

export async function removeMemberAction(input: { groupId: string; memberId: string }) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/members/${encodeURIComponent(input.memberId)}`,
    { method: 'DELETE' },
    groupQueryKeys(input.groupId),
  );
}

export async function renameMemberAction(input: {
  groupId: string;
  memberId: string;
  displayName: string;
}) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/members/${encodeURIComponent(input.memberId)}`,
    { method: 'PATCH', body: JSON.stringify({ displayName: input.displayName }) },
    groupQueryKeys(input.groupId),
  );
}

export async function setMemberRoleAction(input: {
  groupId: string;
  memberId: string;
  role: 'MANAGER' | 'MEMBER' | 'VIEWER';
}) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/members/${encodeURIComponent(input.memberId)}/role`,
    { method: 'PUT', body: JSON.stringify({ role: input.role }) },
    groupQueryKeys(input.groupId),
  );
}

export async function unlinkMemberAction(input: { groupId: string; memberId: string }) {
  return actionRequest(
    `/api/groups/${encodeURIComponent(input.groupId)}/members/${encodeURIComponent(input.memberId)}/link`,
    { method: 'DELETE' },
    groupQueryKeys(input.groupId),
  );
}

export async function leaveGroupAction(groupId: string): Promise<ActionState> {
  return actionRequest(`/api/groups/${encodeURIComponent(groupId)}/leave`, { method: 'POST' }, [
    ...groupAndListQueryKeys(groupId),
    ['account'],
  ]);
}

export async function deleteGroupAction(groupId: string): Promise<ActionState> {
  return actionRequest(`/api/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' }, [
    ...groupAndListQueryKeys(groupId),
    ['account'],
  ]);
}
