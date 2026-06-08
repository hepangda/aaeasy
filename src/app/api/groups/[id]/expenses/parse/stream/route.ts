/**
 * Streaming AI-assisted expense parsing endpoint.
 *
 * POST /api/groups/:id/expenses/parse/stream
 * Body: { text, images?, current? }
 *
 * Auth: caller needs WRITE_EXPENSE on the group.
 * Rate limit: 10 requests / minute / user (or per-IP for share visitors).
 *
 * Returns `text/event-stream` with one of these event types per frame:
 *   FIELD  { name, value }   each top-level scalar/array field
 *   SPLIT  { mode, rows }    the resolved per-member split state
 *   META   { unresolved }    names AI used that we couldn't match
 *   DONE   { tookMs }        clean end of stream
 *   ERROR  { code, detail? } terminal — no more events follow
 *
 * Heartbeat comments (`: hb`) flow every 20s to keep proxies alive.
 *
 * The non-streaming sibling route at `../route.ts` stays unchanged as a
 * fallback for scripts and programmatic callers.
 */

import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { aiParseExpenseStream } from '@/lib/expenses/ai-parse-stream';
import { encodeSse, encodeSseComment } from '@/lib/expenses/sse';
import { currentSnapshotSchema } from '@/lib/expenses/ai-schema';
import { consume } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 20_000;

const bodySchema = z
  .object({
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
    current: currentSnapshotSchema.optional(),
  })
  .refine((v) => v.text.trim().length > 0 || v.images.length > 0, {
    message: 'INVALID_BODY',
  });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;

  let access;
  try {
    access = await requireGroupAccess(groupId, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) {
      const code =
        e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    throw e;
  }

  const principal =
    access.kind === 'user'
      ? `user:${access.userId}`
      : `share:${access.shareLinkId}`;
  const ip = await getClientIp();
  const rl = consume(`ai-parse:${principal}:${ip}`, {
    windowMs: 60_000,
    max: 10,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      name: true,
      defaultCurrency: true,
      members: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, displayName: true },
      },
    },
  });
  if (!group) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const locale = await getLocale();
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort(), {
    once: true,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const enqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      enqueue(encodeSseComment('connected'));
      heartbeat = setInterval(() => enqueue(encodeSseComment('hb')), HEARTBEAT_MS);

      try {
        for await (const event of aiParseExpenseStream(
          {
            text: parsed.data.text,
            images: parsed.data.images,
            members: group.members,
            groupName: group.name,
            defaultCurrency: group.defaultCurrency,
            locale,
            current: parsed.data.current,
          },
          abortController.signal,
        )) {
          if (closed) break;
          switch (event.type) {
            case 'field':
              enqueue(encodeSse('FIELD', { name: event.name, value: event.value }));
              break;
            case 'split':
              enqueue(encodeSse('SPLIT', { mode: event.mode, rows: event.rows }));
              break;
            case 'meta':
              enqueue(encodeSse('META', { unresolved: event.unresolved }));
              break;
            case 'done':
              enqueue(encodeSse('DONE', { tookMs: event.tookMs }));
              break;
            case 'error':
              enqueue(
                encodeSse('ERROR', {
                  code: event.code,
                  ...(event.detail ? { detail: event.detail } : {}),
                }),
              );
              break;
          }
        }
      } catch (e) {
        enqueue(
          encodeSse('ERROR', {
            code: 'UPSTREAM_FAILED',
            detail: (e as Error).message,
          }),
        );
      } finally {
        cleanup();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
