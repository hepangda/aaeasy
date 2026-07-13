import { DurableObject } from 'cloudflare:workers';
import type { GroupEvent } from '@aaeasy/contracts';
import type { WorkerEnv } from '../env';

type RealtimeMessage =
  | { type: 'ready'; revision: string }
  | { type: 'resync'; revision: string }
  | { type: 'pong'; at: string }
  | { type: 'event'; event: GroupEvent };

const EVENT_HISTORY_LIMIT = 256;

export class GroupRoom extends DurableObject<WorkerEnv> {
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
    const history = (await this.ctx.storage.get<GroupEvent[]>('events')) ?? [];

    if (since === null) {
      this.send(server, { type: 'resync', revision: currentRevision.toString() });
    } else if (since < currentRevision) {
      const missed = history
        .filter((event) => BigInt(event.revision) > since)
        .sort((left, right) => Number(BigInt(left.revision) - BigInt(right.revision)));
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
    } else if (since > currentRevision) {
      this.send(server, { type: 'resync', revision: currentRevision.toString() });
    } else {
      this.send(server, { type: 'ready', revision: currentRevision.toString() });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(event: GroupEvent): Promise<void> {
    const history = (await this.ctx.storage.get<GroupEvent[]>('events')) ?? [];
    if (history.some((candidate) => candidate.revision === event.revision)) return;

    history.push(event);
    history.sort((left, right) => Number(BigInt(left.revision) - BigInt(right.revision)));
    if (history.length > EVENT_HISTORY_LIMIT) {
      history.splice(0, history.length - EVENT_HISTORY_LIMIT);
    }
    await this.ctx.storage.put('events', history);

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

  private send(socket: WebSocket, message: RealtimeMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, 'send failed');
    }
  }
}
