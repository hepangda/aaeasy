import { NextResponse } from 'next/server';
import { z } from 'zod';
import { finishAuthentication } from '@/lib/auth/webauthn';
import { createSession } from '@/lib/auth/session';
import { claimPendingShareLink } from '@/lib/auth/claim-share';

export const runtime = 'nodejs';

const bodySchema = z.object({
  challengeId: z.string().min(1),
  response: z.unknown(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });

  try {
    const { userId } = await finishAuthentication(
      parsed.data.challengeId,
      parsed.data.response as Parameters<typeof finishAuthentication>[1],
    );
    await createSession(userId);
    // If the user just hit a member-bound /s/ link, bind it now.
    const claimedGroupId = await claimPendingShareLink(userId);
    return NextResponse.json({ ok: true, claimedGroupId });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'VERIFICATION_FAILED';
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
