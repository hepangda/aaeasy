import {
  loginSchema,
  registerSchema,
  renameCredentialSchema,
  setPasswordSchema,
} from '@aaeasy/contracts';
import {
  allowedUsernames,
  passkeyCredentials,
  passwordCredentials,
  users,
} from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { and, count, desc, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app-env';
import { claimPendingShareLink } from '../auth/claim';
import {
  createSession,
  destroyCurrentSession,
  getCurrentSession,
  requireUser,
} from '../auth/session';
import {
  finishAuthentication,
  finishRegistration,
  startAuthentication,
  startRegistration,
} from '../auth/webauthn';
import { hashPassword, verifyPassword } from '../lib/password';
import { randomCredentialName } from '../lib/random-name';
import { getClientIp } from '../lib/request';
import { fieldErrors } from '../lib/validation';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const authRoutes = new Hono<AppEnv>();

function initialAllowedUsernames(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(/[\s,;]+/u)
        .map((value) => value.trim().toLowerCase())
        .filter(
          (value) => value.length >= 3 && value.length <= 32 && /^[a-zA-Z0-9_.-]+$/u.test(value),
        ),
    ),
  ];
}

async function isUsernameAllowed(c: Context<AppEnv>, username: string) {
  const [{ total }] = await c.var.db.select({ total: count() }).from(allowedUsernames);
  const [allowed] = await c.var.db
    .select({ username: allowedUsernames.username })
    .from(allowedUsernames)
    .where(eq(allowedUsernames.username, username))
    .limit(1);
  const initial = initialAllowedUsernames(c.env.INITIAL_ALLOWED_USERNAMES);
  if (total === 0 && initial.length === 0) return false;
  return Boolean(allowed) || initial.includes(username);
}

async function consumeLimit(
  c: Context<AppEnv>,
  key: string,
  input: { windowMs: number; max: number },
) {
  const result = await c.env.AUTH_LIMITER.getByName(key).consume(input);
  if (!result.ok) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((result.retryAfterMs ?? 1000) / 1000))));
  }
  return result.ok;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return String(error.code);
}

authRoutes.get('/session', async (c) => {
  const session = await getCurrentSession(c);
  return c.json({ user: session?.user ?? null });
});

authRoutes.post('/auth/register', async (c) => {
  const allowed = await consumeLimit(c, `register:ip:${getClientIp(c)}`, {
    windowMs: 60 * 60_000,
    max: 5,
  });
  if (!allowed) return c.json({ ok: false, error: 'errors.rate_limited' }, 429);

  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'errors.invalid_input', fieldErrors: fieldErrors(parsed.error) },
      400,
    );
  }
  const username = parsed.data.username.trim();
  const lowered = username.toLowerCase();
  if (!(await isUsernameAllowed(c, lowered))) {
    return c.json({ ok: false, error: 'errors.username_not_allowed' }, 403);
  }
  const [existing] = await c.var.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, lowered))
    .limit(1);
  if (existing) return c.json({ ok: false, error: 'errors.username_taken' }, 409);

  const userId = createId();
  const now = new Date();
  try {
    await c.var.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        displayName: username,
        username: lowered,
        passwordHash: null,
        updatedAt: now,
      });
      if (parsed.data.password) {
        await tx.insert(passwordCredentials).values({
          id: createId(),
          userId,
          passwordHash: await hashPassword(parsed.data.password),
          label: 'Initial password',
        });
      }
    });
  } catch (error) {
    if (databaseErrorCode(error) === '23505') {
      return c.json({ ok: false, error: 'errors.username_taken' }, 409);
    }
    throw error;
  }

  await createSession(c, userId);
  const claimedGroupId = await claimPendingShareLink(c, userId);
  return c.json({
    ok: true,
    redirectTo: claimedGroupId
      ? `/groups/${claimedGroupId}`
      : parsed.data.password
        ? '/'
        : '/account',
  });
});

authRoutes.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'errors.invalid_credentials' }, 400);
  }

  const ipAllowed = await consumeLimit(c, `login:ip:${getClientIp(c)}`, {
    windowMs: 5 * 60_000,
    max: 10,
  });
  const lowered = parsed.data.username.toLowerCase();
  const userAllowed = await consumeLimit(c, `login:user:${lowered}`, {
    windowMs: 15 * 60_000,
    max: 5,
  });
  if (!ipAllowed || !userAllowed) {
    return c.json({ ok: false, error: 'errors.rate_limited' }, 429);
  }

  const [user] = await c.var.db.select().from(users).where(eq(users.username, lowered)).limit(1);
  if (!user) {
    await verifyPassword(DUMMY_PASSWORD_HASH, parsed.data.password);
    return c.json({ ok: false, error: 'errors.invalid_credentials' }, 401);
  }

  const credentials = await c.var.db
    .select()
    .from(passwordCredentials)
    .where(eq(passwordCredentials.userId, user.id))
    .orderBy(desc(passwordCredentials.createdAt));
  let matchedId: string | null = null;
  for (const credential of credentials) {
    if (await verifyPassword(credential.passwordHash, parsed.data.password)) {
      matchedId = credential.id;
      break;
    }
  }

  if (!matchedId && user.passwordHash) {
    if (await verifyPassword(user.passwordHash, parsed.data.password)) {
      matchedId = createId();
      await c.var.db.transaction(async (tx) => {
        await tx.insert(passwordCredentials).values({
          id: matchedId!,
          userId: user.id,
          passwordHash: user.passwordHash!,
          label: 'Migrated password',
          lastUsedAt: new Date(),
        });
        await tx
          .update(users)
          .set({ passwordHash: null, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      });
    }
  }

  if (!matchedId) {
    await verifyPassword(DUMMY_PASSWORD_HASH, parsed.data.password);
    return c.json({ ok: false, error: 'errors.invalid_credentials' }, 401);
  }
  await c.var.db
    .update(passwordCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(passwordCredentials.id, matchedId));
  await createSession(c, user.id);
  const claimedGroupId = await claimPendingShareLink(c, user.id);
  return c.json({ ok: true, redirectTo: claimedGroupId ? `/groups/${claimedGroupId}` : '/' });
});

authRoutes.post('/auth/logout', async (c) => {
  await destroyCurrentSession(c);
  return c.json({ ok: true });
});

authRoutes.put('/auth/password', async (c) => {
  const session = await requireUser(c);
  const parsed = setPasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, fieldErrors: fieldErrors(parsed.error) }, 400);
  }
  await c.var.db.insert(passwordCredentials).values({
    id: createId(),
    userId: session.user.id,
    passwordHash: await hashPassword(parsed.data.password),
    label: parsed.data.label ?? randomCredentialName(),
  });
  await c.var.db
    .update(users)
    .set({ passwordHash: null, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  return c.json({ ok: true });
});

authRoutes.delete('/auth/password/:credentialId', async (c) => {
  const session = await requireUser(c);
  await c.var.db
    .delete(passwordCredentials)
    .where(
      and(
        eq(passwordCredentials.id, c.req.param('credentialId')),
        eq(passwordCredentials.userId, session.user.id),
      ),
    );
  return c.json({ ok: true });
});

authRoutes.post('/auth/webauthn/register/options', async (c) => {
  const session = await requireUser(c);
  return c.json(await startRegistration(c, session.user.id));
});

authRoutes.post('/auth/webauthn/register/verify', async (c) => {
  const session = await requireUser(c);
  const body = (await c.req.json()) as {
    challengeId?: string;
    response?: RegistrationResponseJSON;
    deviceLabel?: string;
  };
  if (!body.challengeId || !body.response) {
    return c.json({ error: 'INVALID_INPUT' }, 400);
  }
  const result = await finishRegistration(
    c,
    session.user.id,
    body.challengeId,
    body.response,
    body.deviceLabel,
  );
  return c.json({ ok: true, ...result });
});

authRoutes.post('/auth/webauthn/login/options', async (c) => {
  const allowed = await consumeLimit(c, `passkey:ip:${getClientIp(c)}`, {
    windowMs: 5 * 60_000,
    max: 20,
  });
  if (!allowed) return c.json({ error: 'RATE_LIMITED' }, 429);
  return c.json(await startAuthentication(c));
});

authRoutes.post('/auth/webauthn/login/verify', async (c) => {
  const body = (await c.req.json()) as {
    challengeId?: string;
    response?: AuthenticationResponseJSON;
  };
  if (!body.challengeId || !body.response) return c.json({ error: 'INVALID_INPUT' }, 400);
  const { userId } = await finishAuthentication(c, body.challengeId, body.response);
  await createSession(c, userId);
  const claimedGroupId = await claimPendingShareLink(c, userId);
  return c.json({ ok: true, redirectTo: claimedGroupId ? `/groups/${claimedGroupId}` : '/' });
});

authRoutes.patch('/auth/credentials/:kind/:credentialId', async (c) => {
  const session = await requireUser(c);
  const parsed = renameCredentialSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const kind = c.req.param('kind');
  if (kind === 'passkey') {
    const updated = await c.var.db
      .update(passkeyCredentials)
      .set({ deviceLabel: parsed.data.label })
      .where(
        and(
          eq(passkeyCredentials.id, c.req.param('credentialId')),
          eq(passkeyCredentials.userId, session.user.id),
        ),
      )
      .returning({ id: passkeyCredentials.id });
    if (updated.length === 0) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  } else if (kind === 'password') {
    const updated = await c.var.db
      .update(passwordCredentials)
      .set({ label: parsed.data.label })
      .where(
        and(
          eq(passwordCredentials.id, c.req.param('credentialId')),
          eq(passwordCredentials.userId, session.user.id),
        ),
      )
      .returning({ id: passwordCredentials.id });
    if (updated.length === 0) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  } else {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }
  return c.json({ ok: true });
});

authRoutes.delete('/auth/passkeys/:credentialId', async (c) => {
  const session = await requireUser(c);
  await c.var.db
    .delete(passkeyCredentials)
    .where(
      and(
        eq(passkeyCredentials.id, c.req.param('credentialId')),
        eq(passkeyCredentials.userId, session.user.id),
      ),
    );
  return c.json({ ok: true });
});
