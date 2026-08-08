import { DurableObject } from 'cloudflare:workers';
import type { GroupEvent } from '@aaeasy/contracts';
import type { WorkerEnv } from '../env';

type RealtimeMessage =
  | { type: 'ready'; revision: string }
  | { type: 'resync'; revision: string }
  | { type: 'pong'; at: string }
  | { type: 'event'; event: GroupEvent };

const EVENT_HISTORY_LIMIT = 256;

/**
 * Per-group fan-out, plus enough recent history to close the gap a client
 * missed while disconnected.
 *
 * History lives in the object's SQLite storage, one row per revision. It used
 * to be a single key holding the whole array, which made every publish a
 * read-256-rows / sort / write-256-rows cycle — the cost of recording an event
 * grew with the number of events already recorded, for no reason.
 */
export class GroupRoom extends DurableObject<WorkerEnv> {
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        `create table if not exists events (
           revision integer primary key,
           payload  text not null
         )`,
      );
      // Retire the pre-SQLite blob; the history it held is at most a few
      // minutes of events and clients recover the gap with a resync.
      await ctx.storage.delete('events');
    });
  }

  async health(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const url = new URL(request.url);
    const sinceRaw = url.searchParams.get('since');
    const currentRevision = BigInt(request.headers.get('x-aaeasy-revision') ?? '0');
    const since = sinceRaw && /^\d+$/u.test(sinceRaw) ? BigInt(sinceRaw) : null;

    if (since === null || since > currentRevision) {
      this.send(server, { type: 'resync', revision: currentRevision.toString() });
    } else if (since < currentRevision) {
      const missed = this.eventsAfter(since);
      // Only replay when the run is unbroken and reaches the current
      // revision; anything else means the client would silently miss a write.
      const contiguous =
        missed.length > 0 &&
        BigInt(missed[0]!.revision) === since + 1n &&
        BigInt(missed.at(-1)!.revision) === currentRevision &&
        missed.every(
          (event, index) =>
            index === 0 || BigInt(event.revision) === BigInt(missed[index - 1]!.revision) + 1n,
        );
      if (contiguous) {
        for (const event of missed) this.send(server, { type: 'event', event });
        this.send(server, { type: 'ready', revision: currentRevision.toString() });
      } else {
        this.send(server, { type: 'resync', revision: currentRevision.toString() });
      }
    } else {
      this.send(server, { type: 'ready', revision: currentRevision.toString() });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(event: GroupEvent): Promise<void> {
    // `insert or ignore` is the dedupe: revision is the primary key, and a
    // retried publish carries the revision it already used.
    const inserted = this.ctx.storage.sql.exec(
      'insert or ignore into events (revision, payload) values (?, ?)',
      Number(event.revision),
      JSON.stringify(event),
    ).rowsWritten;
    if (inserted === 0) return;

    this.ctx.storage.sql.exec(
      `delete from events
       where revision <= coalesce(
         (select revision from events order by revision desc limit 1 offset ?),
         -1
       )`,
      EVENT_HISTORY_LIMIT - 1,
    );

    for (const socket of this.ctx.getWebSockets()) {
      this.send(socket, { type: 'event', event });
    }
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === 'string' && message === 'ping') {
      this.send(socket, { type: 'pong', at: new Date().toISOString() });
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  private eventsAfter(since: bigint): GroupEvent[] {
    return this.ctx.storage.sql
      .exec<{ payload: string }>(
        'select payload from events where revision > ? order by revision',
        Number(since),
      )
      .toArray()
      .map((row) => JSON.parse(row.payload) as GroupEvent);
  }

  private send(socket: WebSocket, message: RealtimeMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, 'send failed');
    }
  }
}
