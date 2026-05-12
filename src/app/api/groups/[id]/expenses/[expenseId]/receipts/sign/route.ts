import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import {
  ALLOWED_RECEIPT_MIMES,
  MAX_RECEIPT_BYTES,
  buildReceiptPrefix,
  isAllowedReceiptMime,
} from '@/lib/storage/blob';

export const runtime = 'nodejs';

const clientPayloadSchema = z.object({
  mime: z.enum(ALLOWED_RECEIPT_MIMES),
  size: z.number().int().positive().max(MAX_RECEIPT_BYTES),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  const { id: groupId, expenseId } = await params;

  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const access = await requireGroupAccess(groupId, 'WRITE_EXPENSE');

        const exp = await prisma.expense.findUnique({
          where: { id: expenseId },
          select: { groupId: true, lockedBySettlementId: true, deletedAt: true },
        });
        if (!exp || exp.groupId !== groupId || exp.deletedAt) {
          throw new Error('NOT_FOUND');
        }
        if (exp.lockedBySettlementId) {
          throw new Error('EXPENSE_LOCKED');
        }

        let payload: unknown;
        try {
          payload = JSON.parse(clientPayload ?? '{}');
        } catch {
          throw new Error('INVALID_BODY');
        }
        const parsed = clientPayloadSchema.safeParse(payload);
        if (!parsed.success || !isAllowedReceiptMime(parsed.data.mime)) {
          throw new Error('INVALID_BODY');
        }

        const prefix = buildReceiptPrefix(groupId, expenseId);
        if (!pathname.startsWith(prefix) || pathname.length > 512) {
          throw new Error('INVALID_KEY');
        }

        return {
          allowedContentTypes: [...ALLOWED_RECEIPT_MIMES],
          maximumSizeInBytes: MAX_RECEIPT_BYTES,
          validUntil: Date.now() + 60_000,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            groupId,
            expenseId,
            pathname,
            mime: parsed.data.mime,
            size: parsed.data.size,
            uploadedById: access.kind === 'user' ? access.userId : null,
          }),
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    if (e instanceof AccessError) {
      const code = e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    const error = e instanceof Error ? e.message : 'UPLOAD_TOKEN_FAILED';
    const status = error === 'EXPENSE_LOCKED' ? 409 : error === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ error }, { status });
  }
}
