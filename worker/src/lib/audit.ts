import type { Database } from '@aaeasy/db';
import { auditLogs } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import type { GroupAccess } from '../auth/access';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export interface AuditActor {
  type: 'USER' | 'SHARE';
  id: string;
}

/**
 * Actions worth reconstructing after the fact. Anything that changes who can
 * see or write a ledger belongs here — those used to go unrecorded, so the
 * audit log could only ever answer questions about expenses.
 */
export type AuditAction =
  | 'GROUP_CREATE'
  | 'GROUP_RENAME'
  | 'GROUP_DELETE'
  | 'MEMBER_ADD'
  | 'MEMBER_RENAME'
  | 'MEMBER_REMOVE'
  | 'MEMBER_ROLE_CHANGE'
  | 'MEMBER_UNLINK'
  | 'MEMBER_LINK'
  | 'MEMBER_LEAVE'
  | 'OWNERSHIP_TRANSFER'
  | 'SHARE_LINK_CREATE'
  | 'SHARE_LINK_REVOKE'
  | 'INVITATION_CREATE'
  | 'INVITATION_CANCEL'
  | 'INVITATION_ACCEPT'
  | 'INVITATION_REJECT'
  | 'EXPENSE_CREATE'
  | 'EXPENSE_UPDATE'
  | 'EXPENSE_DELETE'
  | 'SETTLEMENT_CREATE'
  | 'SETTLEMENT_REOPEN'
  | 'SETTLEMENT_ENTRY_CREATE'
  | 'SETTLEMENT_ENTRY_DELETE';

export type AuditTarget =
  | 'Group'
  | 'Member'
  | 'Membership'
  | 'ShareLink'
  | 'Invitation'
  | 'Expense'
  | 'Settlement'
  | 'SettlementEntry';

export function auditActor(access: GroupAccess): AuditActor {
  return access.kind === 'user'
    ? { type: 'USER', id: access.userId }
    : { type: 'SHARE', id: access.shareLinkId };
}

export function userActor(userId: string): AuditActor {
  return { type: 'USER', id: userId };
}

/**
 * Record one change. `diff` is what the column was always for: a `before`/
 * `after` pair narrow enough to read at a glance, never the whole row.
 */
export async function writeAudit(
  db: Executor,
  input: {
    groupId: string;
    actor: AuditActor;
    action: AuditAction;
    targetType: AuditTarget;
    targetId: string;
    diff?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    id: createId(),
    groupId: input.groupId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    diffJson: input.diff ?? null,
  });
}

/** `{ before, after }` for a single field, skipping no-op changes. */
export function fieldDiff<T>(field: string, before: T, after: T): Record<string, unknown> | null {
  return before === after ? null : { [field]: { before, after } };
}
