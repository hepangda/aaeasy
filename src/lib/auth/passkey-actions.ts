'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';

export async function deletePasskeyAction(credentialId: string): Promise<{ ok: boolean }> {
  const ctx = await requireUser();
  await prisma.passkeyCredential.deleteMany({
    where: { id: credentialId, userId: ctx.user.id },
  });
  revalidatePath('/account');
  return { ok: true };
}
