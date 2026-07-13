import { groups, members } from '@aaeasy/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { requireGroupAccess } from '../auth/access';
import { getClientIp } from '../lib/request';
import { AiParseError, parseExpenseWithAi, type CurrentExpenseSnapshot } from '../services/ai';

export const aiRoutes = new Hono<AppEnv>();

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
    current: z.custom<CurrentExpenseSnapshot>().optional(),
  })
  .refine((value) => value.text.trim().length > 0 || value.images.length > 0);

function encodeSse(event: string, value: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

async function context(c: Parameters<typeof requireGroupAccess>[0], groupId: string) {
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const principal =
    access.kind === 'user' ? `user:${access.userId}` : `share:${access.shareLinkId}`;
  const limit = await c.env.AUTH_LIMITER.getByName(`ai:${principal}:${getClientIp(c)}`).consume({
    windowMs: 60_000,
    max: 10,
  });
  if (!limit.ok) return { error: 'RATE_LIMITED' as const };
  const [group] = await c.var.db
    .select({ name: groups.name, defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return { error: 'NOT_FOUND' as const };
  const memberRows = await c.var.db
    .select({ id: members.id, displayName: members.displayName })
    .from(members)
    .where(and(eq(members.groupId, groupId)))
    .orderBy(asc(members.sortOrder));
  return { group, members: memberRows };
}

function aiStatus(error: AiParseError): 400 | 502 | 503 | 504 {
  if (error.code === 'NOT_CONFIGURED') return 503;
  if (
    error.code === 'EMPTY_INPUT' ||
    error.code === 'TOO_LONG' ||
    error.code === 'IMAGE_UNSUPPORTED'
  )
    return 400;
  if (error.code === 'TIMEOUT') return 504;
  return 502;
}

aiRoutes.post('/groups/:groupId/expenses/parse', async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'INVALID_BODY' }, 400);
  const loaded = await context(c, c.req.param('groupId'));
  if ('error' in loaded) {
    return c.json({ error: loaded.error }, loaded.error === 'RATE_LIMITED' ? 429 : 404);
  }
  try {
    const suggestion = await parseExpenseWithAi(c.env, {
      ...parsed.data,
      members: loaded.members,
      groupName: loaded.group.name,
      defaultCurrency: loaded.group.defaultCurrency,
      locale: c.req.query('locale')?.startsWith('zh') ? 'zh-CN' : 'en-US',
    });
    return c.json({ suggestion });
  } catch (error) {
    if (error instanceof AiParseError) {
      return c.json({ error: error.code, detail: error.message }, aiStatus(error));
    }
    throw error;
  }
});

aiRoutes.post('/groups/:groupId/expenses/parse/stream', async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'INVALID_BODY' }, 400);
  const loaded = await context(c, c.req.param('groupId'));
  if ('error' in loaded) {
    return c.json({ error: loaded.error }, loaded.error === 'RATE_LIMITED' ? 429 : 404);
  }
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const startedAt = performance.now();
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await writer.write(new TextEncoder().encode(': connected\n\n'));
        const suggestion = await parseExpenseWithAi(c.env, {
          ...parsed.data,
          members: loaded.members,
          groupName: loaded.group.name,
          defaultCurrency: loaded.group.defaultCurrency,
          locale: c.req.query('locale')?.startsWith('zh') ? 'zh-CN' : 'en-US',
        });
        for (const name of [
          'title',
          'occurredAt',
          'currency',
          'amount',
          'payerMemberId',
          'note',
          'isDraft',
          'fxRateOverride',
          'tags',
          'reasoning',
          'ambiguousHint',
        ] as const) {
          await writer.write(encodeSse('FIELD', { name, value: suggestion[name] }));
        }
        if (suggestion.split) await writer.write(encodeSse('SPLIT', suggestion.split));
        await writer.write(encodeSse('META', { unresolved: suggestion.unresolved }));
        await writer.write(encodeSse('DONE', { tookMs: performance.now() - startedAt }));
      } catch (error) {
        const code = error instanceof AiParseError ? error.code : 'UPSTREAM_FAILED';
        const detail = error instanceof Error ? error.message : undefined;
        await writer.write(encodeSse('ERROR', { code, detail }));
      } finally {
        await writer.close();
      }
    })(),
  );
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});
