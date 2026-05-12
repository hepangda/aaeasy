import { prisma } from '@/lib/db';

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export function getInitialAllowedUsernames(): string[] {
  const raw = process.env.INITIAL_ALLOWED_USERNAMES ?? '';
  const values = raw
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(
      (value) => value.length >= 3 && value.length <= 32 && USERNAME_RE.test(value),
    );

  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export async function isUsernameAllowed(username: string): Promise<boolean> {
  const lowered = username.toLowerCase();
  const initialAllowed = getInitialAllowedUsernames();
  const [total, allowed] = await prisma.$transaction([
    prisma.allowedUsername.count(),
    prisma.allowedUsername.findUnique({
      where: { username: lowered },
      select: { username: true },
    }),
  ]);

  if (total === 0 && initialAllowed.length === 0) return false;
  return allowed !== null || initialAllowed.includes(lowered);
}
