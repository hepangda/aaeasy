import { actionRequest, groupQueryKeys, type ActionResult } from '@/spa/api';

export type InvitationRole = 'MANAGER' | 'MEMBER' | 'VIEWER';
export type InvitationActionState = ActionResult;
export type BulkInvitationResult = ActionResult & {
  accepted?: string[];
  rejected?: string[];
  failed?: Array<{ id: string; error: string }>;
};

export async function inviteUserToMemberAction(input: {
  groupId: string;
  memberId: string;
  username: string;
  assignedRole: InvitationRole;
  message?: string;
}) {
  return actionRequest(
    `/api/groups/${input.groupId}/invitations`,
    { method: 'POST', body: JSON.stringify(input) },
    groupQueryKeys(input.groupId),
  );
}

export async function acceptInvitationsAction(ids: string[]): Promise<BulkInvitationResult> {
  return actionRequest(
    '/api/invitations/accept',
    { method: 'POST', body: JSON.stringify({ ids }) },
    // Accepting joins groups whose ids the caller does not have here; the
    // `group`/`ledger` prefixes invalidate whichever ones were involved.
    [['groups'], ['group'], ['ledger'], ['account']],
  );
}

export async function rejectInvitationsAction(ids: string[]): Promise<BulkInvitationResult> {
  return actionRequest(
    '/api/invitations/reject',
    { method: 'POST', body: JSON.stringify({ ids }) },
    [['groups']],
  );
}

export async function rejectAllInvitationsAction(): Promise<BulkInvitationResult> {
  return actionRequest('/api/invitations/reject-all', { method: 'POST' }, [['groups']]);
}

export async function cancelInvitationAction(input: { groupId: string; invitationId: string }) {
  return actionRequest(
    `/api/groups/${input.groupId}/invitations/${input.invitationId}`,
    { method: 'DELETE' },
    groupQueryKeys(input.groupId),
  );
}
