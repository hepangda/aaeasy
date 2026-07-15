import {
  expenseSplits,
  expenses,
  groupMemberships,
  groups,
  members,
  receipts,
  settlementEntries,
  users,
} from '@aaeasy/db/schema';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { buildOidcLogoutUrl, revokeOidcRefreshToken } from '../auth/oidc';
import { clearCurrentSessionCookie, currentOidcTokens, requireUser } from '../auth/session';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';
import { deleteReceiptObjects } from '../storage/receipts';

export const accountRoutes = new Hono<AppEnv>();

const transferSchema = z.object({ newOwnerUserId: z.string().min(1) });

accountRoutes.get('/account', async (c) => {
  const session = await requireUser(c);
  const ownedRows = await c.var.db
    .select({ id: groups.id, name: groups.name })
    .from(groupMemberships)
    .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
    .where(
      and(
        eq(groupMemberships.userId, session.user.id),
        eq(groupMemberships.role, 'OWNER'),
        isNull(groups.deletedAt),
      ),
    )
    .orderBy(asc(groupMemberships.joinedAt));
  const ownedIds = ownedRows.map((group) => group.id);
  const ownedCounts =
    ownedIds.length === 0
      ? []
      : await c.var.db
          .select({ groupId: members.groupId, total: count() })
          .from(members)
          .where(inArray(members.groupId, ownedIds))
          .groupBy(members.groupId);
  const countByGroup = new Map(ownedCounts.map((row) => [row.groupId, row.total]));

  let allLedgers: Array<{
    id: string;
    name: string;
    defaultCurrency: string;
    createdAt: string;
    deletedAt: string | null;
    memberCount: number;
  }> = [];
  if (session.user.isSuperAdmin) {
    const [ledgerRows, counts] = await Promise.all([
      c.var.db
        .select({
          id: groups.id,
          name: groups.name,
          defaultCurrency: groups.defaultCurrency,
          createdAt: groups.createdAt,
          deletedAt: groups.deletedAt,
        })
        .from(groups)
        .orderBy(asc(groups.deletedAt), desc(groups.createdAt)),
      c.var.db
        .select({ groupId: members.groupId, total: count() })
        .from(members)
        .groupBy(members.groupId),
    ]);
    const allCounts = new Map(counts.map((row) => [row.groupId, row.total]));
    allLedgers = ledgerRows.map((group) => ({
      ...group,
      createdAt: group.createdAt.toISOString(),
      deletedAt: group.deletedAt?.toISOString() ?? null,
      memberCount: allCounts.get(group.id) ?? 0,
    }));
  }

  return c.json({
    user: session.user,
    ownedGroups: ownedRows.map((group) => ({
      ...group,
      memberCount: countByGroup.get(group.id) ?? 0,
    })),
    allLedgers,
  });
});

accountRoutes.put('/groups/:groupId/ownership', async (c) => {
  const session = await requireUser(c);
  const groupId = c.req.param('groupId');
  const parsed = transferSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.newOwnerUserId === session.user.id) {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }
  const [mine] = await c.var.db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.groupId, groupId)))
    .limit(1);
  if (mine?.role !== 'OWNER') return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  const [target] = await c.var.db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.userId, parsed.data.newOwnerUserId),
        eq(groupMemberships.groupId, groupId),
      ),
    )
    .limit(1);
  if (!target) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  const [targetMember] = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.linkedUserId, parsed.data.newOwnerUserId)))
    .limit(1);
  if (!targetMember) return c.json({ ok: false, error: 'errors.target_not_linked' }, 409);
  const revision = await c.var.db.transaction(async (tx) => {
    await tx
      .update(groupMemberships)
      .set({ role: 'OWNER' })
      .where(
        and(
          eq(groupMemberships.userId, parsed.data.newOwnerUserId),
          eq(groupMemberships.groupId, groupId),
        ),
      );
    await tx
      .update(groupMemberships)
      .set({ role: 'MANAGER' })
      .where(
        and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.groupId, groupId)),
      );
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    actorId: session.user.id,
  });
  return c.json({ ok: true, revision });
});

accountRoutes.delete('/account', async (c) => {
  const session = await requireUser(c);
  const oidcTokens = await currentOidcTokens(c);
  const owned = await c.var.db
    .select({ groupId: groupMemberships.groupId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.role, 'OWNER')));
  const ownedGroupIds = owned.map((ownedGroup) => ownedGroup.groupId);
  const storedReceipts =
    ownedGroupIds.length === 0
      ? []
      : await c.var.db
          .select({ objectKey: receipts.objectKey })
          .from(receipts)
          .innerJoin(expenses, eq(expenses.id, receipts.expenseId))
          .where(inArray(expenses.groupId, ownedGroupIds));

  await c.var.db.transaction(async (tx) => {
    for (const ownedGroup of owned) {
      const groupExpenseIds = tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.groupId, ownedGroup.groupId));
      await tx.delete(expenseSplits).where(inArray(expenseSplits.expenseId, groupExpenseIds));
      await tx.delete(settlementEntries).where(eq(settlementEntries.groupId, ownedGroup.groupId));
      await tx.delete(expenses).where(eq(expenses.groupId, ownedGroup.groupId));
      await tx.delete(members).where(eq(members.groupId, ownedGroup.groupId));
      await tx.delete(groups).where(eq(groups.id, ownedGroup.groupId));
    }
    await tx.delete(users).where(eq(users.id, session.user.id));
  });
  clearCurrentSessionCookie(c);

  if (storedReceipts.length > 0) {
    c.executionCtx.waitUntil(
      deleteReceiptObjects(
        c.env.RECEIPTS,
        storedReceipts.map((receipt) => receipt.objectKey),
      ).catch((error) =>
        console.error(
          JSON.stringify({
            message: 'receipt cleanup failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      ),
    );
  }
  if (oidcTokens) {
    c.executionCtx.waitUntil(
      revokeOidcRefreshToken(c.env, oidcTokens.refreshToken).catch((error) =>
        console.error(
          JSON.stringify({
            message: 'OIDC refresh-token revocation failed after account deletion',
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      ),
    );
  }
  return c.json({
    ok: true,
    redirectTo: buildOidcLogoutUrl(c.env, oidcTokens?.idToken),
  });
});
