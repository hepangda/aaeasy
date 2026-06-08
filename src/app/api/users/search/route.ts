import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';
import { consume } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const MIN_QUERY_LEN = 3;
const MAX_RESULTS = 8;

/**
 * Username prefix-search used by the account-binding dialog's "@mention"
 * field. Returns an empty list (200) for queries under MIN_QUERY_LEN — the
 * client also enforces this, but we re-check server-side so callers can't
 * bypass the gate with curl.
 *
 * Auth-gated to logged-in users only; excludes the caller from results.
 * Rate-limited to 10 calls / 5 s per user.
 */
export async function GET(req: Request) {
  const ctx = await getCurrentSession();
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const rl = consume(`users:search:${ctx.user.id}`, {
    windowMs: 5_000,
    max: 10,
  });
  if (!rl.ok) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  const url = new URL(req.url);
  const raw = (url.searchParams.get('q') ?? '').trim();
  if (raw.length < MIN_QUERY_LEN) {
    return NextResponse.json({ users: [] });
  }

  const users = await prisma.user.findMany({
    where: {
      username: { startsWith: raw, mode: 'insensitive' },
      id: { not: ctx.user.id },
    },
    select: { username: true, displayName: true },
    orderBy: { username: 'asc' },
    take: MAX_RESULTS,
  });

  // username is nullable on the User model but startsWith narrows to rows
  // that have one. Filter defensively for the type checker.
  const filtered = users
    .filter((u): u is { username: string; displayName: string } => !!u.username)
    .map((u) => ({ username: u.username, displayName: u.displayName }));

  return NextResponse.json({ users: filtered });
}
