/**
 * AI-assisted expense parsing endpoint.
 *
 * POST /api/groups/:id/expenses/parse
 * Body: { text: string }
 *
 * Auth: caller needs WRITE_EXPENSE on the group.
 * Rate limit: 10 requests / minute / user (or per-IP for share visitors).
 *
 * The endpoint is a thin wrapper around `aiParseExpense`. It loads the
 * group's members + default currency, runs the parser, and returns the
 * normalized suggestion. The client is expected to surface this in a
 * review UI before submission.
 */

import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { aiParseExpense, AiParseError } from '@/lib/expenses/ai-parse';
import { consume } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().max(1_000).optional().default(''),
  images: z
    .array(
      z.object({
        name: z.string().max(120).optional(),
        mime: z.string().max(64),
        dataUrl: z.string().max(6_000_000),
      }),
    )
    .max(2)
    .optional()
    .default([]),
}).refine((v) => v.text.trim().length > 0 || v.images.length > 0, {
  message: 'INVALID_BODY',
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = performance.now();
  const timings: { name: string; durationMs: number }[] = [];
  const measure = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const phaseStartedAt = performance.now();
    try {
      return await fn();
    } finally {
      timings.push({ name, durationMs: performance.now() - phaseStartedAt });
    }
  };
  const timedJson = (
    body: unknown,
    init?: ResponseInit,
  ): NextResponse<unknown> => {
    const headers = new Headers(init?.headers);
    const totalMs = performance.now() - startedAt;
    const serverTiming = [
      ...timings,
      { name: 'total', durationMs: totalMs },
    ]
      .map((t) => `${t.name};dur=${Math.round(t.durationMs)}`)
      .join(', ');
    headers.set('Server-Timing', serverTiming);
    return NextResponse.json(body, { ...init, headers });
  };

  const { id: groupId } = await params;

  let access;
  try {
    access = await measure('auth', () =>
      requireGroupAccess(groupId, 'WRITE_EXPENSE'),
    );
  } catch (e) {
    if (e instanceof AccessError) {
      const code =
        e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return timedJson({ error: e.code }, { status: code });
    }
    throw e;
  }

  // Rate-limit per principal: signed-in user or share-link id; fall back
  // to IP for safety. Modest budget — the LLM is paid by token.
  const principal =
    access.kind === 'user'
      ? `user:${access.userId}`
      : `share:${access.shareLinkId}`;
  const ip = await measure('client_ip', () => getClientIp());
  const rl = consume(`ai-parse:${principal}:${ip}`, {
    windowMs: 60_000,
    max: 10,
  });
  if (!rl.ok) {
    return timedJson(
      { error: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  let body: unknown;
  try {
    body = await measure('body', () => req.json());
  } catch {
    return timedJson({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return timedJson({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const group = await measure('db', () =>
    prisma.group.findUnique({
      where: { id: groupId },
      select: {
        defaultCurrency: true,
        members: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, displayName: true },
        },
      },
    }),
  );
  if (!group) {
    return timedJson({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const locale = await measure('locale', () => getLocale());

  try {
    const suggestion = await measure('ai', () =>
      aiParseExpense({
        text: parsed.data.text,
        images: parsed.data.images,
        members: group.members,
        defaultCurrency: group.defaultCurrency,
        locale,
      }),
    );
    return timedJson({ suggestion });
  } catch (e) {
    if (e instanceof AiParseError) {
      const status =
        e.code === 'NOT_CONFIGURED'
          ? 503
          : e.code === 'EMPTY_INPUT' ||
              e.code === 'TOO_LONG' ||
              e.code === 'IMAGE_UNSUPPORTED'
            ? 400
            : e.code === 'TIMEOUT'
              ? 504
              : 502;
      return timedJson({ error: e.code, detail: e.message }, { status });
    }
    throw e;
  }
}
