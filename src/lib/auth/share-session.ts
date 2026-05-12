/**
 * Anonymous "share session" — issued when an unauthenticated visitor unlocks
 * a /s/[token] link. The cookie is scoped to a single ShareLink (and thus a
 * single group).
 *
 * The cookie value is a random opaque token; only its sha256 is stored in DB
 * (mirroring how regular User sessions work in `auth/session.ts`).
 */

import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { generateSessionToken, hashSessionToken, hashIp } from './tokens';
import type { ShareScope } from '@prisma/client';

export const SHARE_SESSION_COOKIE = 'aaeasy_share';
const SHARE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

async function readClientHints() {
  const hdrs = await headers();
  const userAgent = hdrs.get('user-agent') ?? null;
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? null;
  return { userAgent, ipHash: hashIp(ip) };
}

export async function createShareSession(shareLinkId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SHARE_TTL_MS);
  const { userAgent, ipHash } = await readClientHints();

  await prisma.shareSession.create({
    data: { tokenHash, shareLinkId, expiresAt, userAgent, ipHash },
  });

  const cookieStore = await cookies();
  cookieStore.set(SHARE_SESSION_COOKIE, token, {
    path: '/',
    expires: expiresAt,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return { token, expiresAt };
}

export interface ShareContext {
  shareLinkId: string;
  groupId: string;
  scope: ShareScope;
  /** When the link is bound to a member, all writes are scoped to that
   *  member's identity. Null = legacy unbound link (typically read-only). */
  boundMemberId: string | null;
}

/**
 * Resolve the current share-cookie (if any). Returns null on missing,
 * expired-session, or revoked-link cases. **Expired links** (where the
 * link's own `expiresAt` has passed but `revokedAt` is still null) are
 * degraded to read-only: `scope = 'READ'` and `boundMemberId = null`.
 * Visitors keep being able to view the group; they lose all write power.
 */
export async function getCurrentShareSession(): Promise<ShareContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SHARE_SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashSessionToken(token);

  const row = await prisma.shareSession.findUnique({
    where: { tokenHash },
    include: { shareLink: true },
  });
  if (!row) return null;
  if (row.expiresAt <= new Date()) return null;
  // Revoked = hard kill. The cookie's session may still exist but the
  // visitor gets no access at all.
  if (row.shareLink.revokedAt) return null;

  const linkExpired =
    row.shareLink.expiresAt !== null &&
    row.shareLink.expiresAt <= new Date();

  return {
    shareLinkId: row.shareLink.id,
    groupId: row.shareLink.groupId,
    scope: linkExpired ? 'READ' : row.shareLink.scope,
    boundMemberId: linkExpired ? null : row.shareLink.memberId,
  };
}

export async function destroyCurrentShareSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SHARE_SESSION_COOKIE)?.value;
  cookieStore.delete(SHARE_SESSION_COOKIE);
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  await prisma.shareSession.deleteMany({ where: { tokenHash } });
}
