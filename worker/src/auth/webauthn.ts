import { authChallenges, passkeyCredentials, users } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env';
import { ApiError } from '../lib/errors';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function relyingParty(c: Context<AppEnv>) {
  const url = new URL(c.env.APP_URL);
  return { id: url.hostname, origin: url.origin, name: c.env.APP_NAME };
}

export async function startRegistration(c: Context<AppEnv>, userId: string) {
  const [user] = await c.var.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ApiError('NOT_FOUND', 404);
  const existing = await c.var.db
    .select({ id: passkeyCredentials.id, transports: passkeyCredentials.transports })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, userId));
  const rp = relyingParty(c);
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userID: new TextEncoder().encode(user.id),
    userName: user.username ?? user.displayName,
    userDisplayName: user.displayName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
    excludeCredentials: existing.map((credential) => ({
      id: credential.id,
      transports: (credential.transports ?? []) as AuthenticatorTransportFuture[],
    })),
  });
  const challengeId = createId();
  await c.var.db.insert(authChallenges).values({
    id: challengeId,
    type: 'REG',
    challenge: options.challenge,
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return { challengeId, options };
}

export async function finishRegistration(
  c: Context<AppEnv>,
  userId: string,
  challengeId: string,
  response: RegistrationResponseJSON,
  deviceLabel?: string,
) {
  const [stored] = await c.var.db
    .select()
    .from(authChallenges)
    .where(
      and(
        eq(authChallenges.id, challengeId),
        eq(authChallenges.type, 'REG'),
        eq(authChallenges.userId, userId),
      ),
    )
    .limit(1);
  if (!stored) throw new ApiError('CHALLENGE_NOT_FOUND', 404);
  if (stored.expiresAt <= new Date()) {
    await c.var.db.delete(authChallenges).where(eq(authChallenges.id, challengeId));
    throw new ApiError('CHALLENGE_EXPIRED', 410);
  }

  const rp = relyingParty(c);
  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new ApiError('VERIFICATION_FAILED', 400);
    }

    const { credential } = verification.registrationInfo;
    await c.var.db.insert(passkeyCredentials).values({
      id: credential.id,
      userId,
      publicKey: credential.publicKey,
      counter: BigInt(credential.counter),
      transports: credential.transports ?? [],
      deviceLabel: deviceLabel?.trim().slice(0, 64) || null,
    });
    return { credentialId: credential.id };
  } finally {
    await c.var.db.delete(authChallenges).where(eq(authChallenges.id, challengeId));
  }
}

export async function startAuthentication(c: Context<AppEnv>) {
  const rp = relyingParty(c);
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: 'preferred',
  });
  const challengeId = createId();
  await c.var.db.insert(authChallenges).values({
    id: challengeId,
    type: 'AUTH',
    challenge: options.challenge,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return { challengeId, options };
}

export async function finishAuthentication(
  c: Context<AppEnv>,
  challengeId: string,
  response: AuthenticationResponseJSON,
) {
  const [stored] = await c.var.db
    .select()
    .from(authChallenges)
    .where(and(eq(authChallenges.id, challengeId), eq(authChallenges.type, 'AUTH')))
    .limit(1);
  if (!stored) throw new ApiError('CHALLENGE_NOT_FOUND', 404);
  if (stored.expiresAt <= new Date()) {
    await c.var.db.delete(authChallenges).where(eq(authChallenges.id, challengeId));
    throw new ApiError('CHALLENGE_EXPIRED', 410);
  }

  const [credential] = await c.var.db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.id, response.id))
    .limit(1);
  if (!credential) {
    await c.var.db.delete(authChallenges).where(eq(authChallenges.id, challengeId));
    throw new ApiError('UNKNOWN_CREDENTIAL', 404);
  }

  const rp = relyingParty(c);
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
        transports: (credential.transports ?? []) as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    });
    if (!verification.verified) throw new ApiError('VERIFICATION_FAILED', 400);
    await c.var.db
      .update(passkeyCredentials)
      .set({
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      })
      .where(eq(passkeyCredentials.id, credential.id));
    return { userId: credential.userId };
  } finally {
    await c.var.db.delete(authChallenges).where(eq(authChallenges.id, challengeId));
  }
}
