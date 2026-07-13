import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireGroupAccess } from '../auth/access';
import { createLedgerCsv } from '../export/csv';
import { createLedgerPdf } from '../export/pdf';
import { loadLedger } from '../services/ledger';

export const exportRoutes = new Hono<AppEnv>();

function retryAfterSeconds(retryAfterMs: number | undefined): string {
  return String(Math.max(1, Math.ceil((retryAfterMs ?? 1_000) / 1_000)));
}

function launchInterval(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 60_000 ? parsed : 20_000;
}

function contentDisposition(groupName: string, stamp: string, extension: 'csv' | 'pdf'): string {
  const unicodeName = `${groupName.replace(/[^\w\u4e00-\u9fa5._-]+/gu, '_').slice(0, 60) || 'aaeasy'}-${stamp}.${extension}`;
  const asciiName = `${groupName.replace(/[^A-Za-z0-9._-]+/gu, '_').slice(0, 60) || 'aaeasy'}-${stamp}.${extension}`;
  const encoded = encodeURIComponent(unicodeName).replace(
    /['()]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

exportRoutes.get('/groups/:groupId/export', async (c) => {
  const groupId = c.req.param('groupId');
  const access = await requireGroupAccess(c, groupId, 'READ_GROUP');
  if (access.kind !== 'user') return c.json({ error: 'FORBIDDEN' }, 403);
  const format = c.req.query('format') ?? 'pdf';
  if (format !== 'pdf' && format !== 'csv') {
    return c.json({ error: 'INVALID_FORMAT' }, 400);
  }
  const ledger = await loadLedger(c.var.db, groupId);
  if (!ledger) return c.json({ error: 'NOT_FOUND' }, 404);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    return new Response(createLedgerCsv(ledger), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': contentDisposition(ledger.group.name, stamp, 'csv'),
        'Cache-Control': 'no-store',
      },
    });
  }
  const userLimit = await c.env.AUTH_LIMITER.getByName(`pdf:${access.userId}`).consume({
    windowMs: 60_000,
    max: 5,
  });
  if (!userLimit.ok) {
    return c.json({ error: 'RATE_LIMITED' }, 429, {
      'Retry-After': retryAfterSeconds(userLimit.retryAfterMs),
    });
  }
  const globalLimit = await c.env.AUTH_LIMITER.getByName('pdf:browser-launch').consume({
    windowMs: launchInterval(c.env.PDF_LAUNCH_INTERVAL_MS),
    max: 1,
  });
  if (!globalLimit.ok) {
    return c.json({ error: 'PDF_BUSY' }, 429, {
      'Retry-After': retryAfterSeconds(globalLimit.retryAfterMs),
    });
  }
  const locale = c.req.query('locale')?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  let pdf: ArrayBuffer;
  try {
    pdf = await createLedgerPdf(c, ledger, locale);
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number(error.status)
        : null;
    if (status === 429) {
      return c.json({ error: 'PDF_BUSY' }, 503, { 'Retry-After': '20' });
    }
    throw error;
  }
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(ledger.group.name, stamp, 'pdf'),
      'Cache-Control': 'no-store',
    },
  });
});
