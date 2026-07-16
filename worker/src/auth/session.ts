import type { SessionUserDto } from '@aaeasy/contracts';
import { sessions, shareLinks, shareSessions, users } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env';
import { generateToken, hashIp, sha256 } from '../lib/crypto';
import { ApiError } from '../lib/errors';
import { getClientIp, isSecureRequest } from '../lib/request';
import {
  checkOidcSession,
  fetchOidcProfile,
  oidcAccessTokenNeedsRefresh,
  OidcSessionInvalidError,
  refreshOidcTokens,
  sealStoredTokens,
  type OidcProfile,
  type StoredOidcTokens,
  unsealStoredTokens,
} from './oidc';

export const SESSION_COOKIE = 'aaeasy_session';
export const SHARE_SESSION_COOKIE = 'aaeasy_share';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHARE_TTL_MS = 12 * 60 * 60 * 1000;
const LAST_SEEN_WINDOW_MS = 60 * 60 * 1000;
const OIDC_VALIDATION_WINDOW_MS = 5 * 60 * 1000;

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

function profileDisplayName(profile: OidcProfile, fallback?: string): string {
  return (profile.name ?? profile.email ?? fallback ?? profile.sub).trim().slice(0, 64);
}

async function syncOidcUser(
  db: Pick<Context<AppEnv>['var']['db'], 'select' | 'insert' | 'update'>,
  profile: OidcProfile,
): Promise<{ user: Omit<SessionUserDto, 'isSuperAdmin'>; existed: boolean }> {
  const [existing] = await db.select().from(users).where(eq(users.id, profile.sub)).limit(1);
  const username = profile.preferred_username;
  const updatedAt = new Date();

  // KeyForge owns aliases case-insensitively. Release a stale local alias
  // before assigning it to the authoritative OIDC subject.
  await db
    .update(users)
    .set({ username: null, updatedAt })
    .where(
      and(ne(users.id, profile.sub), sql`lower(${users.username}) = ${username.toLowerCase()}`),
    );

  const identity = {
    username,
    displayName: profileDisplayName(profile, existing?.displayName),
    email: profile.email ?? null,
    picture: profile.picture ?? null,
    updatedAt,
  };
  if (existing) {
    await db.update(users).set(identity).where(eq(users.id, profile.sub));
    return {
      existed: true,
      user: {
        id: existing.id,
        ...identity,
      },
    };
  }

  await db.insert(users).values({
    id: profile.sub,
    ...identity,
  });
  return {
    existed: false,
    user: { id: profile.sub, ...identity },
  };
}

function sessionContext(input: {
  sessionId: string;
  userAgent: string | null;
  isSuperAdmin: boolean;
  user: {
    id: string;
    displayName: string;
    username: string | null;
    email: string | null;
    picture: string | null;
  };
}): SessionContext {
  return {
    sessionId: input.sessionId,
    userAgent: input.userAgent,
    user: { ...input.user, isSuperAdmin: input.isSuperAdmin },
  };
}

export async function createSession(
  c: Context<AppEnv>,
  profile: OidcProfile,
  oidcTokens: StoredOidcTokens,
): Promise<SessionContext> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [hints, tokenHash, sealedTokens] = await Promise.all([
    clientHints(c),
    sha256(token),
    sealStoredTokens(oidcTokens, c.env.OIDC_SESSION_SECRET),
  ]);
  const sessionId = createId();
  const isSuperAdmin = profile.groups?.includes('admins') ?? false;
  const synced = await c.var.db.transaction(async (tx) => {
    const user = await syncOidcUser(tx, profile);
    await tx.insert(sessions).values({
      id: sessionId,
      tokenHash,
      userId: profile.sub,
      expiresAt,
      oidcTokens: sealedTokens,
      oidcValidatedAt: new Date(),
      isSuperAdmin,
      ...hints,
    });
    return user;
  });
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c, expiresAt));
  return sessionContext({
    sessionId,
    userAgent: hints.userAgent,
    isSuperAdmin,
    user: synced.user,
  });
}

function validationDue(validatedAt: Date): boolean {
  return Date.now() - validatedAt.getTime() > OIDC_VALIDATION_WINDOW_MS;
}

async function validateCurrentSession(
  c: Context<AppEnv>,
  sessionId: string,
  forceOidcValidation = false,
): Promise<SessionContext | null> {
  const prepared = await c.var.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .for('update', { of: sessions });
    if (!row || row.session.expiresAt <= new Date()) {
      if (row) await tx.delete(sessions).where(eq(sessions.id, row.session.id));
      return { kind: 'invalid' as const };
    }
    const oidcValidationDue = validationDue(row.session.oidcValidatedAt);
    if (!oidcValidationDue && !forceOidcValidation) {
      return {
        kind: 'current' as const,
        session: sessionContext({
          sessionId: row.session.id,
          userAgent: row.session.userAgent,
          isSuperAdmin: row.session.isSuperAdmin,
          user: row.user,
        }),
      };
    }

    let tokens: StoredOidcTokens;
    try {
      tokens = await unsealStoredTokens(row.session.oidcTokens, c.env.OIDC_SESSION_SECRET);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      await tx.delete(sessions).where(eq(sessions.id, row.session.id));
      return { kind: 'invalid' as const };
    }

    try {
      const upstreamStatus = await checkOidcSession(c.env, tokens.refreshToken, row.session.userId);
      if (upstreamStatus === 'inactive') throw new OidcSessionInvalidError();
      if (!oidcValidationDue) {
        if (upstreamStatus === 'active') {
          await tx
            .update(sessions)
            .set({ oidcValidatedAt: new Date() })
            .where(eq(sessions.id, row.session.id));
        }
        return {
          kind: 'current' as const,
          session: sessionContext({
            sessionId: row.session.id,
            userAgent: row.session.userAgent,
            isSuperAdmin: row.session.isSuperAdmin,
            user: row.user,
          }),
        };
      }
      if (oidcAccessTokenNeedsRefresh(tokens)) {
        tokens = await refreshOidcTokens(c.env, tokens);
        await tx
          .update(sessions)
          .set({ oidcTokens: await sealStoredTokens(tokens, c.env.OIDC_SESSION_SECRET) })
          .where(eq(sessions.id, row.session.id));
      }
      return {
        kind: 'validate' as const,
        tokens,
        userId: row.session.userId,
      };
    } catch (error) {
      if (!(error instanceof OidcSessionInvalidError)) throw error;
      await tx.delete(sessions).where(eq(sessions.id, row.session.id));
      return { kind: 'invalid' as const };
    }
  });

  if (prepared.kind === 'invalid') return null;
  if (prepared.kind === 'current') return prepared.session;

  let profile: OidcProfile;
  try {
    profile = await fetchOidcProfile(c.env, prepared.tokens.accessToken);
  } catch (error) {
    if (!(error instanceof OidcSessionInvalidError)) throw error;
    await c.var.db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  if (profile.sub !== prepared.userId) {
    await c.var.db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  return c.var.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .for('update', { of: sessions });
    if (!row || row.session.expiresAt <= new Date()) {
      if (row) await tx.delete(sessions).where(eq(sessions.id, row.session.id));
      return null;
    }
    if (!validationDue(row.session.oidcValidatedAt)) {
      return sessionContext({
        sessionId: row.session.id,
        userAgent: row.session.userAgent,
        isSuperAdmin: row.session.isSuperAdmin,
        user: row.user,
      });
    }
    const synced = await syncOidcUser(tx, profile);
    const isSuperAdmin = profile.groups?.includes('admins') ?? false;
    await tx
      .update(sessions)
      .set({ oidcValidatedAt: new Date(), isSuperAdmin, lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));
    return sessionContext({
      sessionId: row.session.id,
      userAgent: row.session.userAgent,
      isSuperAdmin,
      user: synced.user,
    });
  });
}

export async function getCurrentSession(
  c: Context<AppEnv>,
  options: { forceOidcValidation?: boolean } = {},
): Promise<SessionContext | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await c.var.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, await sha256(token)))
    .limit(1);
  if (!row) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }
  if (row.session.expiresAt <= new Date()) {
    await c.var.db.delete(sessions).where(eq(sessions.id, row.session.id));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }
  if (options.forceOidcValidation || validationDue(row.session.oidcValidatedAt)) {
    const validated = await validateCurrentSession(c, row.session.id, options.forceOidcValidation);
    if (!validated) deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return validated;
  }
  if (Date.now() - row.session.lastSeenAt.getTime() > LAST_SEEN_WINDOW_MS) {
    await c.var.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));
  }
  return sessionContext({
    sessionId: row.session.id,
    userAgent: row.session.userAgent,
    isSuperAdmin: row.session.isSuperAdmin,
    user: row.user,
  });
}

export async function requireUser(c: Context<AppEnv>): Promise<SessionContext> {
  const session = await getCurrentSession(c);
  if (!session) throw new ApiError('UNAUTHORIZED', 401);
  return session;
}

export async function currentOidcTokens(c: Context<AppEnv>): Promise<StoredOidcTokens | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await c.var.db
    .select({ oidcTokens: sessions.oidcTokens })
    .from(sessions)
    .where(eq(sessions.tokenHash, await sha256(token)))
    .limit(1);
  if (!row) return null;
  try {
    return await unsealStoredTokens(row.oidcTokens, c.env.OIDC_SESSION_SECRET);
  } catch {
    return null;
  }
}

export async function destroyCurrentSession(c: Context<AppEnv>): Promise<StoredOidcTokens | null> {
  const token = getCookie(c, SESSION_COOKIE);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  if (!token) return null;
  const tokenHash = await sha256(token);
  const [row] = await c.var.db
    .select({ oidcTokens: sessions.oidcTokens })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  await c.var.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  if (!row) return null;
  try {
    return await unsealStoredTokens(row.oidcTokens, c.env.OIDC_SESSION_SECRET);
  } catch {
    return null;
  }
}

export function clearCurrentSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
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
