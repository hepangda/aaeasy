/**
 * In-memory token-bucket-ish sliding-window rate limiter.
 *
 * Suitable for a single-process self-hosted deployment. When we move to
 * multiple instances we'd swap the implementation to Redis/Postgres but
 * keep this same `consume()` interface.
 *
 * Each call to `consume(key, opts)` records a timestamp and rejects if more
 * than `max` events have happened within the trailing `windowMs`.
 */

interface Bucket {
  // Sorted-ascending timestamps of recent events (epoch ms).
  events: number[];
  // For occasional GC.
  lastTouched: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

export interface RateLimitOpts {
  /** Window length in ms. */
  windowMs: number;
  /** Max events allowed within the window. */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Epoch ms when next event would be permitted (only set if !ok). */
  retryAfterMs?: number;
}

export function consume(key: string, opts: RateLimitOpts): RateLimitResult {
  const now = Date.now();
  const cutoff = now - opts.windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) gc(now);
    bucket = { events: [], lastTouched: now };
    buckets.set(key, bucket);
  }

  // Drop expired events from the front.
  while (bucket.events.length && bucket.events[0]! < cutoff) {
    bucket.events.shift();
  }

  bucket.lastTouched = now;

  if (bucket.events.length >= opts.max) {
    const oldest = bucket.events[0]!;
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: oldest + opts.windowMs - now,
    };
  }

  bucket.events.push(now);
  return { ok: true, remaining: opts.max - bucket.events.length };
}

/** Reset a key (used in tests, or on successful auth to grant fresh quota). */
export function reset(key: string): void {
  buckets.delete(key);
}

function gc(now: number): void {
  // Drop the oldest 25% of buckets that haven't been touched recently.
  const entries = Array.from(buckets.entries()).sort(
    (a, b) => a[1].lastTouched - b[1].lastTouched,
  );
  const drop = Math.max(1, Math.floor(entries.length / 4));
  for (let i = 0; i < drop; i++) buckets.delete(entries[i]![0]);
  // Avoid unused-var warning in environments where `now` is unused.
  void now;
}
