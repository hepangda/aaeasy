import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import {
  ALLOWED_RECEIPT_MIMES,
  MAX_RECEIPT_BYTES,
  isAllowedReceiptMime,
} from '@/lib/storage/s3';
import { publish } from '@/lib/realtime/pgNotify';

export const runtime = 'nodejs';

// ─── POST: confirm a successful upload ───────────────────────────────────

const postSchema = z.object({
  key: z.string().min(1).max(512),
  mime: z.enum(ALLOWED_RECEIPT_MIMES),
  size: z.number().int().positive().max(MAX_RECEIPT_BYTES),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  const { id: groupId, expenseId } = await params;

  let access;
  try {
    access = await requireGroupAccess(groupId, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) {
      const code = e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    throw e;
  }

  const exp = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: { groupId: true, lockedBySettlementId: true, deletedAt: true },
  });
  if (!exp || exp.groupId !== groupId || exp.deletedAt) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (exp.lockedBySettlementId) {
    return NextResponse.json({ error: 'EXPENSE_LOCKED' }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success || !isAllowedReceiptMime(parsed.data.mime)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  // Defense in depth: only accept keys under the expected prefix so a client
  // can't trick us into recording a key that points to someone else's object.
  const prefix = `group/${groupId}/expense/${expenseId}/`;
  if (!parsed.data.key.startsWith(prefix)) {
    return NextResponse.json({ error: 'INVALID_KEY' }, { status: 400 });
  }

  const uploadedById = access.kind === 'user' ? access.userId : null;

  const receipt = await prisma.receipt.create({
    data: {
      expenseId,
      objectKey: parsed.data.key,
      mime: parsed.data.mime,
      sizeBytes: parsed.data.size,
      uploadedById,
    },
    select: { id: true },
  });

  await publish({ type: 'RECEIPT_CHANGED', groupId, expenseId }).catch(() => {});

  return NextResponse.json({ id: receipt.id });
}