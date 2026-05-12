import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import {
  ALLOWED_RECEIPT_MIMES,
  MAX_RECEIPT_BYTES,
  buildReceiptKey,
  extFromMime,
  isAllowedReceiptMime,
  presignPut,
} from '@/lib/storage/s3';

export const runtime = 'nodejs';

const bodySchema = z.object({
  mime: z.enum(ALLOWED_RECEIPT_MIMES),
  size: z.number().int().positive().max(MAX_RECEIPT_BYTES),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  const { id: groupId, expenseId } = await params;

  try {
    await requireGroupAccess(groupId, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) {
      const code = e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    throw e;
  }

  // Confirm the expense exists in this group and isn't locked.
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isAllowedReceiptMime(parsed.data.mime)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const key = buildReceiptKey(groupId, expenseId, extFromMime(parsed.data.mime));
  const url = await presignPut(key, parsed.data.mime, parsed.data.size, 60);

  return NextResponse.json({ key, url, mime: parsed.data.mime });
}
