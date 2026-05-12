import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { generateSessionToken, hashSessionToken, hashIp } from './tokens';

export const SESSION_COOKIE = 'aaeasy_session';
const SESSION_TTL_DAYS = 30;

function expiryFromNow(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function readClientHints() {
  const hdrs = await headers();
  const userAgent = hdrs.get('user-agent') ?? null;
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    hdrs.get('x-real-ip') ??
    null;
  return { userAgent, ipHash: hashIp(ip) };
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = expiryFromNow();
  const { userAgent, ipHash } = await readClientHints();

  await prisma.session.create({
    data: { userId, tokenHash, expiresAt, userAgent, ipHash },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    path: '/',
    expires: expiresAt,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return { token, expiresAt };
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashSessionToken(token);

  const row = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row) return null;

  if (row.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }

  // Sliding window: bump lastSeenAt at most once per hour
  const HOUR = 60 * 60 * 1000;
  if (Date.now() - row.lastSeenAt.getTime() > HOUR) {
    await prisma.session
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }

  return { session: row, user: row.user };
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  cookieStore.delete(SESSION_COOKIE);
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function requireUser() {
  const ctx = await getCurrentSession();
  if (!ctx) throw new Error('UNAUTHORIZED');
  return ctx;
}
