import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'errors.username_too_short')
  .max(32, 'errors.username_too_long')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'errors.username_invalid_chars');

export const passwordSchema = z
  .string()
  .min(8, 'errors.password_too_short')
  .max(256, 'errors.password_too_long');

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema.optional(),
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const setPasswordSchema = z.object({
  password: passwordSchema,
  label: z.string().trim().min(1).max(64).optional(),
});

export const renameCredentialSchema = z.object({
  label: z.string().trim().min(1).max(64),
});

export type AuthState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  redirectTo?: string;
};

export interface CredentialDto {
  id: string;
  kind: 'passkey' | 'password';
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}
