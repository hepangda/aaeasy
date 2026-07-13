import { actionRequest } from '@/spa/api';

export type InvitationRole = 'MANAGER' | 'MEMBER' | 'VIEWER';
export type InvitationActionState = { ok: boolean; error?: string };
export type BulkInvitationResult = {
  ok: boolean;
  accepted?: string[];
  rejected?: string[];
  failed?: Array<{ id: string; error: string }>;
  error?: string;
};

export async function inviteUserToMemberAction(input: {
  groupId: string;
  memberId: string;
  username: string;
  assignedRole: InvitationRole;
  message?: string;
}) {
  return actionRequest(`/api/groups/${input.groupId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function acceptInvitationsAction(ids: string[]): Promise<BulkInvitationResult> {
  return actionRequest('/api/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function rejectInvitationsAction(ids: string[]): Promise<BulkInvitationResult> {
  return actionRequest('/api/invitations/reject', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function rejectAllInvitationsAction(): Promise<BulkInvitationResult> {
  return actionRequest('/api/invitations/reject-all', { method: 'POST' });
}

export async function cancelInvitationAction(input: { groupId: string; invitationId: string }) {
  return actionRequest(`/api/groups/${input.groupId}/invitations/${input.invitationId}`, {
    method: 'DELETE',
  });
}
