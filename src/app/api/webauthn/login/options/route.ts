import { NextResponse } from 'next/server';
import { startAuthentication } from '@/lib/auth/webauthn';
import { consume } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';

export async function POST() {
  const ip = await getClientIp();
  const rl = consume(`webauthn:login:ip:${ip}`, { windowMs: 60_000, max: 20 });
  if (!rl.ok) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const result = await startAuthentication();
  return NextResponse.json(result);
}
