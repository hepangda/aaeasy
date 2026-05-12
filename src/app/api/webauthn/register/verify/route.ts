import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { finishRegistration } from '@/lib/auth/webauthn';

export const runtime = 'nodejs';

// We only validate the envelope; the WebAuthn library validates the inner shape.
// `deviceLabel` accepts the raw User-Agent (~120 chars is normal); the storage
// layer truncates to 64 chars before persisting.
const bodySchema = z.object({
  challengeId: z.string().min(1),
  response: z.unknown(),
  deviceLabel: z.string().max(512).optional(),
});

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });

  try {
    const result = await finishRegistration(
      ctx.user.id,
      parsed.data.challengeId,
      // WebAuthn lib does its own validation
      parsed.data.response as Parameters<typeof finishRegistration>[2],
      parsed.data.deviceLabel,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'VERIFICATION_FAILED';
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
