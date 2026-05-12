import { NextResponse } from 'next/server';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { subscribe, type GroupEvent } from '@/lib/realtime/pgNotify';

export const runtime = 'nodejs';
// Each browser tab opens one long-lived connection; never cache.
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;

  try {
    await requireGroupAccess(groupId, 'READ_GROUP');
  } catch (e) {
    if (e instanceof AccessError) {
      const code =
        e.code === 'UNAUTHENTICATED' ? 401 : e.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: e.code }, { status: code });
    }
    throw e;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      function send(line: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          cleanup();
        }
      }

      function cleanup() {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      // Initial ":ok" comment so the EventSource fires `onopen` quickly.
      send(': connected\n\n');

      try {
        unsubscribe = await subscribe(groupId, (event: GroupEvent) => {
          send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[stream] subscribe failed:', err);
        send('event: ERROR\ndata: {"reason":"SUBSCRIBE_FAILED"}\n\n');
        cleanup();
        return;
      }

      // Heartbeat keeps proxies (and the client) from idle-closing.
      heartbeat = setInterval(() => send(': hb\n\n'), HEARTBEAT_MS);

      // We can't natively detect client disconnect from inside ReadableStream
      // without an AbortSignal — the controller throws on next `enqueue`,
      // which `send` catches and triggers `cleanup`.
    },
    cancel() {
      // Triggered when the consumer closes the stream — we'll clean up via
      // the next failed enqueue. Nothing else to do here.
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
