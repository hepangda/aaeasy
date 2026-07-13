import type { SessionUserDto } from '@aaeasy/contracts';
import { sessions, shareLinks, shareSessions, users } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, eq, ne } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env';
import { generateToken, hashIp, sha256 } from '../lib/crypto';
import { ApiError } from '../lib/errors';
import { getClientIp, isSecureRequest } from '../lib/request';

export const SESSION_COOKIE = 'aaeasy_session';
export const SHARE_SESSION_COOKIE = 'aaeasy_share';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHARE_TTL_MS = 12 * 60 * 60 * 1000;
const LAST_SEEN_WINDOW_MS = 60 * 60 * 1000;

export interface SessionContext {
  sessionId: string;
  userAgent: string | null;
  user: SessionUserDto;
}

export interface ShareContext {
  shareLinkId: string;
  groupId: string;
  scope: 'READ' | 'WRITE';
  boundMemberId: string | null;
}

function cookieOptions(c: Context<AppEnv>, expires: Date) {
  return {
    path: '/',
    expires,
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: isSecureRequest(c),
  };
}

async function clientHints(c: Context<AppEnv>) {
  return {
    userAgent: c.req.header('user-agent') ?? null,
    ipHash: await hashIp(getClientIp(c)),
  };
}

export async function createSession(c: Context<AppEnv>, userId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const hints = await clientHints(c);

  await c.var.db.insert(sessions).values({
    id: createId(),
    tokenHash: await sha256(token),
    userId,
    expiresAt,
    ...hints,
  });
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c, expiresAt));
  return { expiresAt };
}

export async function getCurrentSession(c: Context<AppEnv>): Promise<SessionContext | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const [row] = await c.var.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, await sha256(token)))
    .limit(1);
  if (!row) return null;

  if (row.session.expiresAt <= new Date()) {
    await c.var.db.delete(sessions).where(eq(sessions.id, row.session.id));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }

  if (Date.now() - row.session.lastSeenAt.getTime() > LAST_SEEN_WINDOW_MS) {
    await c.var.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));
  }

  return {
    sessionId: row.session.id,
    userAgent: row.session.userAgent,
    user: {
      id: row.user.id,
      displayName: row.user.displayName,
      username: row.user.username,
      isSuperAdmin: row.user.isSuperAdmin,
    },
  };
}

export async function requireUser(c: Context<AppEnv>): Promise<SessionContext> {
  const session = await getCurrentSession(c);
  if (!session) throw new ApiError('UNAUTHORIZED', 401);
  return session;
}

export async function destroyCurrentSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  if (!token) return;
  await c.var.db.delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
}

export async function createShareSession(c: Context<AppEnv>, shareLinkId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SHARE_TTL_MS);
  const hints = await clientHints(c);
  await c.var.db.insert(shareSessions).values({
    id: createId(),
    tokenHash: await sha256(token),
    shareLinkId,
    expiresAt,
    ...hints,
  });
  setCookie(c, SHARE_SESSION_COOKIE, token, cookieOptions(c, expiresAt));
  return { expiresAt };
}

export async function getCurrentShareSession(c: Context<AppEnv>): Promise<ShareContext | null> {
  const token = getCookie(c, SHARE_SESSION_COOKIE);
  if (!token) return null;
  const [row] = await c.var.db
    .select({ session: shareSessions, link: shareLinks })
    .from(shareSessions)
    .innerJoin(shareLinks, eq(shareLinks.id, shareSessions.shareLinkId))
    .where(eq(shareSessions.tokenHash, await sha256(token)))
    .limit(1);
  if (!row || row.session.expiresAt <= new Date() || row.link.revokedAt) return null;

  const expired = row.link.expiresAt !== null && row.link.expiresAt <= new Date();
  return {
    shareLinkId: row.link.id,
    groupId: row.link.groupId,
    scope: expired ? 'READ' : row.link.scope,
    boundMemberId: expired ? null : row.link.memberId,
  };
}

export async function destroyCurrentShareSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SHARE_SESSION_COOKIE);
  deleteCookie(c, SHARE_SESSION_COOKIE, { path: '/' });
  if (!token) return;
  await c.var.db.delete(shareSessions).where(eq(shareSessions.tokenHash, await sha256(token)));
}

export async function clearOtherSessions(c: Context<AppEnv>, userId: string, sessionId: string) {
  await c.var.db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)));
}
