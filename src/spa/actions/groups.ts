import { actionRequest, formString } from '@/spa/api';

export type ActionState = { ok: boolean; error?: string };

export async function createGroupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let members: unknown[] = [];
  try {
    members = JSON.parse(formString(formData, 'members') || '[]') as unknown[];
  } catch {
    return { ok: false, error: 'errors.invalid_input' };
  }
  const result = await actionRequest<
    ActionState & { groupId?: string; unresolvedMention?: boolean }
  >('/api/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: formString(formData, 'name'),
      defaultCurrency: formString(formData, 'defaultCurrency') || 'CNY',
      members,
    }),
  });
  if (result.ok && result.groupId) {
    window.location.assign(
      `/groups/${result.groupId}${result.unresolvedMention ? '?notice=unresolved_mention' : ''}`,
    );
  }
  return result;
}

export async function renameGroupAction(input: {
  groupId: string;
  name: string;
}): Promise<ActionState> {
  return actionRequest(`/api/groups/${encodeURIComponent(input.groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: input.name }),
  });
}

export async function addMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const groupId = formString(formData, 'groupId');
  return actionRequest(`/api/groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ displayName: formString(formData, 'displayName') }),
  });
}

export async function removeMemberAction(input: { groupId: string; memberId: string }) {
  return actionRequest(`/api/groups/${input.groupId}/members/${input.memberId}`, {
    method: 'DELETE',
  });
}

export async function renameMemberAction(input: {
  groupId: string;
  memberId: string;
  displayName: string;
}) {
  return actionRequest(`/api/groups/${input.groupId}/members/${input.memberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName: input.displayName }),
  });
}

export async function setMemberRoleAction(input: {
  groupId: string;
  memberId: string;
  role: 'MANAGER' | 'MEMBER' | 'VIEWER';
}) {
  return actionRequest(`/api/groups/${input.groupId}/members/${input.memberId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role: input.role }),
  });
}

export async function unlinkMemberAction(input: { groupId: string; memberId: string }) {
  return actionRequest(`/api/groups/${input.groupId}/members/${input.memberId}/link`, {
    method: 'DELETE',
  });
}

export async function leaveGroupAction(groupId: string): Promise<ActionState> {
  return actionRequest(`/api/groups/${groupId}/leave`, { method: 'POST' });
}

export async function deleteGroupAction(groupId: string): Promise<ActionState> {
  return actionRequest(`/api/groups/${groupId}`, { method: 'DELETE' });
}
