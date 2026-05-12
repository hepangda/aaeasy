/**
 * Server-side WebAuthn ceremonies.
 *
 * Each ceremony has two stages:
 *   1. options() — generate a challenge, persist it in AuthChallenge, return
 *      the options the browser needs.
 *   2. verify() — look up the stored challenge by id, verify the response,
 *      delete the challenge (single-use), and on success either store a new
 *      credential (registration) or bump the counter (authentication).
 *
 * The challenge id is returned alongside the options so the client must echo
 * it back on verify. We never trust client-provided challenge values.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { RP_ID, RP_NAME, RP_ORIGIN } from './webauthn-config';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function expiry(): Date {
  return new Date(Date.now() + CHALLENGE_TTL_MS);
}

// ─── Registration ────────────────────────────────────────────────────────

export async function startRegistration(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const existing = await prisma.passkeyCredential.findMany({
    where: { userId },
    select: { id: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.username ?? user.displayName,
    userDisplayName: user.displayName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required', // discoverable credentials → usernameless login
      userVerification: 'preferred',
    },
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
  });

  const challenge = await prisma.authChallenge.create({
    data: {
      type: 'REG',
      challenge: options.challenge,
      userId,
      expiresAt: expiry(),
    },
  });

  return { challengeId: challenge.id, options };
}

export async function finishRegistration(
  userId: string,
  challengeId: string,
  response: RegistrationResponseJSON,
  deviceLabel?: string,
) {
  const stored = await prisma.authChallenge.findUnique({ where: { id: challengeId } });
  if (!stored || stored.type !== 'REG' || stored.userId !== userId) {
    throw new Error('CHALLENGE_NOT_FOUND');
  }
  if (stored.expiresAt <= new Date()) {
    await prisma.authChallenge.delete({ where: { id: challengeId } }).catch(() => {});
    throw new Error('CHALLENGE_EXPIRED');
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: stored.challenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
  });

  // Single-use challenge: delete regardless of outcome.
  await prisma.authChallenge.delete({ where: { id: challengeId } });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('VERIFICATION_FAILED');
  }

  const { credential } = verification.registrationInfo;

  await prisma.passkeyCredential.create({
    data: {
      id: credential.id,
      userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: (credential.transports ?? []) as string[],
      deviceLabel: deviceLabel?.slice(0, 64) ?? null,
    },
  });

  return { credentialId: credential.id };
}

// ─── Authentication (usernameless / discoverable) ────────────────────────

export async function startAuthentication() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    // No allowCredentials → usernameless flow: browser picks a discoverable cred.
  });

  const challenge = await prisma.authChallenge.create({
    data: {
      type: 'AUTH',
      challenge: options.challenge,
      expiresAt: expiry(),
    },
  });

  return { challengeId: challenge.id, options };
}

export async function finishAuthentication(
  challengeId: string,
  response: AuthenticationResponseJSON,
) {
  const stored = await prisma.authChallenge.findUnique({ where: { id: challengeId } });
  if (!stored || stored.type !== 'AUTH') throw new Error('CHALLENGE_NOT_FOUND');
  if (stored.expiresAt <= new Date()) {
    await prisma.authChallenge.delete({ where: { id: challengeId } }).catch(() => {});
    throw new Error('CHALLENGE_EXPIRED');
  }

  const credentialId = response.id;
  const cred = await prisma.passkeyCredential.findUnique({ where: { id: credentialId } });
  if (!cred) {
    await prisma.authChallenge.delete({ where: { id: challengeId } });
    throw new Error('UNKNOWN_CREDENTIAL');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: stored.challenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: cred.id,
      publicKey: new Uint8Array(cred.publicKey),
      counter: Number(cred.counter),
      transports: cred.transports as AuthenticatorTransportFuture[],
    },
    requireUserVerification: false,
  });

  await prisma.authChallenge.delete({ where: { id: challengeId } });

  if (!verification.verified) throw new Error('VERIFICATION_FAILED');

  const newCounter = verification.authenticationInfo.newCounter;
  await prisma.passkeyCredential.update({
    where: { id: cred.id },
    data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
  });

  return { userId: cred.userId };
}
