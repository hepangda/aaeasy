import { receipts, expenses } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireGroupAccess } from '../auth/access';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';
import {
  ALLOWED_RECEIPT_MIMES,
  MAX_RECEIPT_BYTES,
  readBodyWithLimit,
  receiptObjectKey,
} from '../storage/receipts';

export const receiptRoutes = new Hono<AppEnv>();

receiptRoutes.post('/groups/:groupId/expenses/:expenseId/receipts', async (c) => {
  const groupId = c.req.param('groupId');
  const expenseId = c.req.param('expenseId');
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const [expense] = await c.var.db
    .select({
      payerMemberId: expenses.payerMemberId,
      lockedBySettlementId: expenses.lockedBySettlementId,
    })
    .from(expenses)
    .where(
      and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNull(expenses.deletedAt)),
    )
    .limit(1);
  if (!expense) return c.json({ error: 'NOT_FOUND' }, 404);
  if (expense.lockedBySettlementId) return c.json({ error: 'EXPENSE_LOCKED' }, 409);
  const constrained =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;
  if (constrained && expense.payerMemberId !== constrained) {
    return c.json({ error: 'FORBIDDEN' }, 403);
  }

  const mime = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_RECEIPT_MIMES.has(mime)) return c.json({ error: 'INVALID_MIME' }, 415);
  const contentLength = c.req.header('content-length');
  const declaredSize = contentLength === undefined ? null : Number(contentLength);
  if (
    declaredSize !== null &&
    (!Number.isInteger(declaredSize) || declaredSize <= 0 || declaredSize > MAX_RECEIPT_BYTES)
  ) {
    return c.json({ error: 'INVALID_SIZE' }, 413);
  }
  const body = await readBodyWithLimit(c.req.raw);
  if (
    body === null ||
    body.byteLength <= 0 ||
    (declaredSize !== null && body.byteLength !== declaredSize)
  ) {
    return c.json({ error: 'INVALID_SIZE' }, 413);
  }

  const objectKey = receiptObjectKey(groupId, expenseId, mime);
  await c.env.RECEIPTS.put(objectKey, body, {
    httpMetadata: { contentType: mime, cacheControl: 'private, max-age=300' },
    customMetadata: { groupId, expenseId },
  });
  const receiptId = createId();
  let revision: string;
  try {
    revision = await c.var.db.transaction(async (tx) => {
      await tx.insert(receipts).values({
        id: receiptId,
        expenseId,
        objectKey,
        mime,
        sizeBytes: body.byteLength,
        uploadedById: access.kind === 'user' ? access.userId : null,
      });
      return bumpGroupRevision(tx, groupId);
    });
  } catch (error) {
    await c.env.RECEIPTS.delete(objectKey);
    throw error;
  }
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'receipt.changed',
    entityId: expenseId,
    actorId: access.kind === 'user' ? access.userId : access.shareLinkId,
  });
  return c.json({ id: receiptId, mime, sizeBytes: body.byteLength, revision }, 201);
});

receiptRoutes.get('/groups/:groupId/expenses/:expenseId/receipts/:receiptId', async (c) => {
  const groupId = c.req.param('groupId');
  const expenseId = c.req.param('expenseId');
  await requireGroupAccess(c, groupId, 'READ_GROUP');
  const [receipt] = await c.var.db
    .select({ objectKey: receipts.objectKey, mime: receipts.mime, sizeBytes: receipts.sizeBytes })
    .from(receipts)
    .innerJoin(expenses, eq(expenses.id, receipts.expenseId))
    .where(
      and(
        eq(receipts.id, c.req.param('receiptId')),
        eq(receipts.expenseId, expenseId),
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
      ),
    )
    .limit(1);
  if (!receipt) return c.json({ error: 'NOT_FOUND' }, 404);
  const object = await c.env.RECEIPTS.get(receipt.objectKey);
  if (!object) return c.json({ error: 'NOT_FOUND' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', receipt.mime);
  headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('Content-Disposition', 'inline');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
});

receiptRoutes.delete('/groups/:groupId/expenses/:expenseId/receipts/:receiptId', async (c) => {
  const groupId = c.req.param('groupId');
  const expenseId = c.req.param('expenseId');
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const [receipt] = await c.var.db
    .select({
      objectKey: receipts.objectKey,
      payerMemberId: expenses.payerMemberId,
      lockedBySettlementId: expenses.lockedBySettlementId,
    })
    .from(receipts)
    .innerJoin(expenses, eq(expenses.id, receipts.expenseId))
    .where(
      and(
        eq(receipts.id, c.req.param('receiptId')),
        eq(receipts.expenseId, expenseId),
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
      ),
    )
    .limit(1);
  if (!receipt) return c.json({ error: 'NOT_FOUND' }, 404);
  if (receipt.lockedBySettlementId) return c.json({ error: 'EXPENSE_LOCKED' }, 409);
  const constrained =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;
  if (constrained && receipt.payerMemberId !== constrained) {
    return c.json({ error: 'FORBIDDEN' }, 403);
  }
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.delete(receipts).where(eq(receipts.id, c.req.param('receiptId')));
    return bumpGroupRevision(tx, groupId);
  });
  c.executionCtx.waitUntil(c.env.RECEIPTS.delete(receipt.objectKey));
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'receipt.changed',
    entityId: expenseId,
    actorId: access.kind === 'user' ? access.userId : access.shareLinkId,
  });
  return c.json({ ok: true, revision });
});
