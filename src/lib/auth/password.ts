import { hash, verify } from '@node-rs/argon2';

// OWASP recommended Argon2id parameters (m=19MiB, t=2, p=1) — tuned for ~50ms.
// algorithm 2 = Argon2id (avoid importing the ambient const enum directly).
const PARAMS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

/**
 * Verifies a password. Returns false on mismatch or malformed hash.
 * Always pass a string hash; never compare raw.
 */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
