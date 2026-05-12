/**
 * Single shared `pg` LISTEN client + per-channel subscriber registry.
 *
 * Why bypass Prisma here?
 *   - `pg_notify` only delivers to clients that are actively `LISTEN`-ing,
 *     which is a long-lived connection — Prisma's connection pool doesn't
 *     expose that affordance reliably.
 *
 * One process, one LISTEN connection, one channel: `aaeasy_events`. Each
 * notification is JSON `{ groupId, type, ... }`; we route to subscribers by
 * groupId. Subscribers are typed callbacks held in a per-group `Set`.
 *
 * The connection auto-reconnects on error with capped exponential backoff.
 *
 * Multi-instance: when we eventually scale beyond 1 process, swap this file
 * for a Redis pub/sub adapter — the public API (`publish`, `subscribe`)
 * stays identical.
 */

import { Client } from 'pg';

const CHANNEL = 'aaeasy_events';

export type GroupEvent =
  | { type: 'EXPENSE_CREATED'; groupId: string; expenseId: string }
  | { type: 'EXPENSE_UPDATED'; groupId: string; expenseId: string }
  | { type: 'EXPENSE_DELETED'; groupId: string; expenseId: string }
  | { type: 'GROUP_UPDATED'; groupId: string }
  | { type: 'MEMBER_CHANGED'; groupId: string }
  | { type: 'RECEIPT_CHANGED'; groupId: string; expenseId: string };

type Subscriber = (event: GroupEvent) => void;

interface Broker {
  client: Client | null;
  ready: Promise<void> | null;
  subs: Map<string, Set<Subscriber>>;
  reconnectAttempt: number;
}

const globalForBroker = globalThis as unknown as { __aaeasy_broker?: Broker };

function getBroker(): Broker {
  if (!globalForBroker.__aaeasy_broker) {
    globalForBroker.__aaeasy_broker = {
      client: null,
      ready: null,
      subs: new Map(),
      reconnectAttempt: 0,
    };
  }
  return globalForBroker.__aaeasy_broker;
}

async function connect(): Promise<void> {
  const broker = getBroker();
  if (broker.client) return;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const client = new Client({ connectionString: url });
  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    let parsed: GroupEvent;
    try {
      parsed = JSON.parse(msg.payload) as GroupEvent;
    } catch {
      return;
    }
    const set = broker.subs.get(parsed.groupId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(parsed);
      } catch {
        // never let one subscriber block the others
      }
    }
  });

  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[pgNotify] client error:', err.message);
    void scheduleReconnect();
  });
  client.on('end', () => {
    void scheduleReconnect();
  });

  broker.client = client;
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  broker.reconnectAttempt = 0;
}

async function scheduleReconnect(): Promise<void> {
  const broker = getBroker();
  if (!broker.client) return;
  try {
    await broker.client.end();
  } catch {
    // ignore
  }
  broker.client = null;
  broker.ready = null;
  const attempt = ++broker.reconnectAttempt;
  const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
  setTimeout(() => {
    void ensureConnected().catch(() => {
      // next error handler will reschedule
    });
  }, delay);
}

async function ensureConnected(): Promise<void> {
  const broker = getBroker();
  if (broker.client) return;
  if (!broker.ready) {
    broker.ready = connect().catch((e) => {
      broker.ready = null;
      throw e;
    });
  }
  return broker.ready;
}

/**
 * Subscribe to events for a single group. Returns an unsubscribe function.
 * Lazily establishes the LISTEN connection on first subscriber.
 */
export async function subscribe(
  groupId: string,
  callback: Subscriber,
): Promise<() => void> {
  await ensureConnected();
  const broker = getBroker();
  let set = broker.subs.get(groupId);
  if (!set) {
    set = new Set();
    broker.subs.set(groupId, set);
  }
  set.add(callback);
  return () => {
    const s = broker.subs.get(groupId);
    if (!s) return;
    s.delete(callback);
    if (s.size === 0) broker.subs.delete(groupId);
  };
}

/**
 * Publish an event. Uses Prisma's pool so this is safe to call from any
 * server action or route handler — it does NOT depend on the LISTEN client.
 *
 * Note: payloads sent through `pg_notify` are limited to ~8 kB. Keep them
 * tiny — clients should re-fetch on receipt rather than reading from the
 * payload directly.
 */
export async function publish(event: GroupEvent): Promise<void> {
  // Lazy-import prisma to avoid importing it during module evaluation
  // (helps when this file is loaded in edge / build contexts).
  const { prisma } = await import('@/lib/db');
  const json = JSON.stringify(event);
  // pg_notify(channel text, payload text) — both are bound parameters.
  await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${json})`;
}
