import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { buildExportPayload } from '@/lib/export/data';
import { buildPdf } from '@/lib/export/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATS = ['pdf'] as const;
type Format = (typeof FORMATS)[number];

function isFormat(s: string | null): s is Format {
  return !!s && (FORMATS as readonly string[]).includes(s);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;

  try {
    const access = await requireGroupAccess(groupId, 'READ_GROUP');
    // Exporting the whole ledger is restricted to logged-in members of the
    // group; share-link visitors don't get the full dump.
    if (access.kind !== 'user') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
  } catch (e) {
    if (e instanceof AccessError) {
      const code = e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const fmt = searchParams.get('format') ?? 'pdf';
  if (!isFormat(fmt)) {
    return NextResponse.json({ error: 'INVALID_FORMAT' }, { status: 400 });
  }

  const locale = await getLocale();
  const payload = await buildExportPayload(groupId, locale);
  const safeBaseName =
    payload.meta.groupName.replace(/[^\w\u4e00-\u9fa5._-]+/g, '_').slice(0, 60) || 'aaeasy';
  const asciiBaseName =
    payload.meta.groupName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'aaeasy';
  const stamp = payload.meta.generatedAt.toISOString().slice(0, 10);
  const fileName = `${safeBaseName}-${stamp}.pdf`;
  const asciiFileName = `${asciiBaseName}-${stamp}.pdf`;
  const encodedFileName = encodeURIComponent(fileName).replace(
    /['()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  switch (fmt) {
    case 'pdf': {
      const buf = await buildPdf(payload);
      return new Response(buf as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`,
          'Cache-Control': 'no-store',
        },
      });
    }
  }
}
