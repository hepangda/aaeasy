import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { deleteObject, presignGet } from '@/lib/storage/s3';
import { publish } from '@/lib/realtime/pgNotify';

export const runtime = 'nodejs';

// Redirects to a short-lived presigned URL so <img src=...> works directly.
// We never proxy receipt bytes through the Next process.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string; receiptId: string }> },
) {
  const { id: groupId, expenseId, receiptId } = await params;

  try {
    await requireGroupAccess(groupId, 'READ_GROUP');
  } catch (e) {
    if (e instanceof AccessError) {
      const code = e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    throw e;
  }

  const r = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { objectKey: true, mime: true, expenseId: true, expense: { select: { groupId: true } } },
  });
  if (!r || r.expenseId !== expenseId || r.expense.groupId !== groupId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const url = await presignGet(r.objectKey, 300);
  return NextResponse.redirect(url, 302);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string; receiptId: string }> },
) {
  const { id: groupId, expenseId, receiptId } = await params;

  try {
    await requireGroupAccess(groupId, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) {
      const code = e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    throw e;
  }

  const r = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: {
      objectKey: true,
      expenseId: true,
      expense: { select: { groupId: true, lockedBySettlementId: true } },
    },
  });
  if (!r || r.expenseId !== expenseId || r.expense.groupId !== groupId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (r.expense.lockedBySettlementId) {
    return NextResponse.json({ error: 'EXPENSE_LOCKED' }, { status: 409 });
  }

  await prisma.receipt.delete({ where: { id: receiptId } });
  // Best-effort: drop the object too. If it fails we still want the row gone.
  await deleteObject(r.objectKey).catch(() => {});

  await publish({ type: 'RECEIPT_CHANGED', groupId, expenseId }).catch(() => {});

  return NextResponse.json({ ok: true });
}
