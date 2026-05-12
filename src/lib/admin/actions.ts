'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'errors.username_too_short')
  .max(32, 'errors.username_too_long')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'errors.username_invalid_chars')
  .transform((value) => value.toLowerCase());

export type AdminActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

async function requireSuperAdmin() {
  const ctx = await getCurrentSession();
  if (!ctx?.user.isSuperAdmin) throw new Error('FORBIDDEN');
  return ctx;
}

export async function addAllowedUsernameAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const ctx = await requireSuperAdmin();
  const parsed = usernameSchema.safeParse(formData.get('username'));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: 'errors.invalid_input',
      fieldErrors: { username: issue?.message ?? 'errors.invalid_input' },
    };
  }

  await prisma.allowedUsername.upsert({
    where: { username: parsed.data },
    create: { username: parsed.data, createdById: ctx.user.id },
    update: {},
  });
  revalidatePath('/account/admin/usernames');
  return { ok: true };
}

export async function deleteAllowedUsernameAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const parsed = usernameSchema.safeParse(formData.get('username'));
  if (!parsed.success) throw new Error('INVALID_USERNAME');

  await prisma.allowedUsername.deleteMany({ where: { username: parsed.data } });
  revalidatePath('/account/admin/usernames');
}
