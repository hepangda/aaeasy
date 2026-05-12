'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';

const labelSchema = z
  .string()
  .trim()
  .min(1, 'errors.invalid_input')
  .max(64, 'errors.invalid_input');

export type CredentialKind = 'passkey' | 'password';

/**
 * Rename a sign-in credential (passkey or password) belonging to the
 * current user. Used by the account page so users can tell multiple
 * credentials apart in the unified list.
 */
export async function renameCredentialAction(
  kind: CredentialKind,
  credentialId: string,
  rawLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireUser();

  const parsed = labelSchema.safeParse(rawLabel);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'errors.invalid_input' };
  }
  const label = parsed.data;

  if (kind === 'passkey') {
    const updated = await prisma.passkeyCredential.updateMany({
      where: { id: credentialId, userId: ctx.user.id },
      data: { deviceLabel: label },
    });
    if (updated.count === 0) return { ok: false, error: 'errors.not_found' };
  } else {
    const updated = await prisma.passwordCredential.updateMany({
      where: { id: credentialId, userId: ctx.user.id },
      data: { label },
    });
    if (updated.count === 0) return { ok: false, error: 'errors.not_found' };
  }

  revalidatePath('/account');
  return { ok: true };
}
