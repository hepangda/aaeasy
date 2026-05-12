import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { startRegistration } from '@/lib/auth/webauthn';

export const runtime = 'nodejs';

export async function POST() {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const result = await startRegistration(ctx.user.id);
  return NextResponse.json(result);
}
