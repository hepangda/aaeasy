'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  createSession,
  destroyCurrentSession,
  getCurrentSession,
} from '@/lib/auth/session';
import { claimPendingShareLink } from '@/lib/auth/claim-share';
import { isUsernameAllowed } from '@/lib/auth/username-allowlist';
import { consume } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { randomCredentialName } from '@/lib/auth/random-name';

// ─── Schemas ─────────────────────────────────────────────────────────────

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'errors.username_too_short')
  .max(32, 'errors.username_too_long')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'errors.username_invalid_chars');

const passwordSchema = z
  .string()
  .min(8, 'errors.password_too_short')
  .max(256, 'errors.password_too_long');

const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

/** Same as `registerSchema` but without the password — used by the
 *  passkey-first register flow where the user doesn't pick a password. */
const registerNoPasswordSchema = z.object({
  username: usernameSchema,
});

const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

// ─── Result type ─────────────────────────────────────────────────────────

export type AuthState = {
  ok: boolean;
  error?: string; // i18n key
  fieldErrors?: Record<string, string>;
  /** Set on success; the client uses this to redirect (e.g. land on a
   *  claimed group). Server actions in this file never call `redirect()`
   *  themselves so the client can run follow-up work like passkey enrollment
   *  before navigating. */
  redirectTo?: string;
};

// ─── Actions ─────────────────────────────────────────────────────────────

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const ip = await getClientIp();
  const rl = consume(`register:ip:${ip}`, { windowMs: 60 * 60_000, max: 5 });
  if (!rl.ok) return { ok: false, error: 'errors.rate_limited' };

  const parsed = registerSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0]?.toString() ?? '_';
      fe[k] ??= issue.message;
    }
    return { ok: false, error: 'errors.invalid_input', fieldErrors: fe };
  }

  const { username, password } = parsed.data;
  const lowered = username.toLowerCase();

  if (!(await isUsernameAllowed(lowered))) {
    return { ok: false, error: 'errors.username_not_allowed' };
  }

  const existing = await prisma.user.findUnique({ where: { username: lowered } });
  if (existing) return { ok: false, error: 'errors.username_taken' };

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      displayName: username,
      username: lowered,
      passwordHash: null,
      passwordCredentials: {
        create: { passwordHash, label: 'Initial password' },
      },
    },
  });

  await createSession(user.id);
  // If the visitor came via a member-bound share link, bind that
  // member to the freshly-created account and drop them into the group.
  const claimedGroupId = await claimPendingShareLink(user.id);
  return { ok: true, redirectTo: claimedGroupId ? `/groups/${claimedGroupId}` : '/' };
}

/**
 * Passkey-first registration: creates a user with NO password hash. The
 * client is expected to enroll a passkey immediately after this call
 * succeeds; otherwise the user has no way to sign back in (and they
 * should be offered a recovery path — currently "set a password from the
 * account page" via `setPasswordAction`).
 */
export async function registerNoPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const ip = await getClientIp();
  const rl = consume(`register:ip:${ip}`, { windowMs: 60 * 60_000, max: 5 });
  if (!rl.ok) return { ok: false, error: 'errors.rate_limited' };

  const parsed = registerNoPasswordSchema.safeParse({
    username: formData.get('username'),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0]?.toString() ?? '_';
      fe[k] ??= issue.message;
    }
    return { ok: false, error: 'errors.invalid_input', fieldErrors: fe };
  }

  const { username } = parsed.data;
  const lowered = username.toLowerCase();

  if (!(await isUsernameAllowed(lowered))) {
    return { ok: false, error: 'errors.username_not_allowed' };
  }

  const existing = await prisma.user.findUnique({ where: { username: lowered } });
  if (existing) return { ok: false, error: 'errors.username_taken' };

  const user = await prisma.user.create({
    data: { displayName: username, username: lowered, passwordHash: null },
  });

  await createSession(user.id);
  // Note: claim happens here so the cookie binding is correct, but the
  // client may still navigate to /account if passkey enrollment fails.
  await claimPendingShareLink(user.id);
  return { ok: true };
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const ip = await getClientIp();
  // Rate limit login attempts per IP: 10 / 5min.
  const ipRl = consume(`login:ip:${ip}`, { windowMs: 5 * 60_000, max: 10 });
  if (!ipRl.ok) return { ok: false, error: 'errors.rate_limited' };

  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'errors.invalid_credentials' };
  }
  const { username, password } = parsed.data;
  // Per-username bucket as well: 5 / 15min.
  const userRl = consume(`login:user:${username.toLowerCase()}`, {
    windowMs: 15 * 60_000,
    max: 5,
  });
  if (!userRl.ok) return { ok: false, error: 'errors.rate_limited' };

  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    include: {
      passwordCredentials: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  // Constant-ish time: always run argon2 verify even if no user, against a dummy hash.
  const dummy =
    '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  if (!user) {
    await verifyPassword(dummy, password);
    return { ok: false, error: 'errors.invalid_credentials' };
  }

  let matchedCredentialId: string | null = null;
  for (const cred of user.passwordCredentials) {
    if (await verifyPassword(cred.passwordHash, password)) {
      matchedCredentialId = cred.id;
      break;
    }
  }

  if (!matchedCredentialId && user.passwordHash) {
    const legacyOk = await verifyPassword(user.passwordHash, password);
    if (legacyOk) {
      const migrated = await prisma.passwordCredential.create({
        data: {
          userId: user.id,
          passwordHash: user.passwordHash,
          label: 'Migrated password',
          lastUsedAt: new Date(),
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: null },
      });
      matchedCredentialId = migrated.id;
    }
  }

  if (!matchedCredentialId) {
    await verifyPassword(dummy, password);
    return { ok: false, error: 'errors.invalid_credentials' };
  }

  await prisma.passwordCredential.update({
    where: { id: matchedCredentialId },
    data: { lastUsedAt: new Date() },
  });

  await createSession(user.id);
  // Same auto-claim logic as register.
  const claimedGroupId = await claimPendingShareLink(user.id);
  return { ok: true, redirectTo: claimedGroupId ? `/groups/${claimedGroupId}` : '/' };
}

export async function logoutAction(): Promise<void> {
  const ctx = await getCurrentSession();
  if (ctx) await destroyCurrentSession();
  redirect('/');
}

/**
 * Set or change the current user's password. Used by passkey-only users
 * who want a recovery option, and by anyone who wants to rotate their
 * password.
 */
export async function setPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const ctx = await getCurrentSession();
  if (!ctx) return { ok: false, error: 'errors.unauthenticated' };

  const parsed = z
    .object({ password: passwordSchema })
    .safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: { password: parsed.error.issues[0]?.message ?? 'errors.invalid_input' },
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const rawLabel = formData.get('label');
  const label =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0
      ? rawLabel.trim().slice(0, 64)
      : randomCredentialName();

  await prisma.passwordCredential.create({
    data: {
      userId: ctx.user.id,
      passwordHash,
      label,
    },
  });

  // Keep legacy column clean once the user starts using credential rows.
  await prisma.user.update({ where: { id: ctx.user.id }, data: { passwordHash: null } });
  return { ok: true };
}

/**
 * Remove the current user's password. This leaves passkey-only sign-in
 * enabled when passkeys exist.
 */
export async function deletePasswordAction(credentialId: string): Promise<AuthState> {
  const ctx = await getCurrentSession();
  if (!ctx) return { ok: false, error: 'errors.unauthenticated' };

  await prisma.passwordCredential.deleteMany({
    where: { id: credentialId, userId: ctx.user.id },
  });
  return { ok: true };
}
