import { argon2id, argon2Verify } from 'hash-wasm';

const PARAMS = {
  iterations: 2,
  memorySize: 19_456,
  parallelism: 1,
  hashLength: 32,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2id({
    password: plain,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    ...PARAMS,
    outputType: 'encoded',
  });
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify({ hash: hashed, password: plain });
  } catch {
    return false;
  }
}
