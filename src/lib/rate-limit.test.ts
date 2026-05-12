import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consume, reset } from './rate-limit';

describe('rate-limit', () => {
  const KEY = 'test:user-x';

  beforeEach(() => {
    reset(KEY);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to max events in the window then rejects', () => {
    const opts = { windowMs: 60_000, max: 3 };
    expect(consume(KEY, opts).ok).toBe(true);
    expect(consume(KEY, opts).ok).toBe(true);
    expect(consume(KEY, opts).ok).toBe(true);
    const last = consume(KEY, opts);
    expect(last.ok).toBe(false);
    expect(last.retryAfterMs).toBeGreaterThan(0);
    expect(last.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('frees up quota as old events expire', () => {
    const opts = { windowMs: 1_000, max: 2 };
    expect(consume(KEY, opts).ok).toBe(true);
    expect(consume(KEY, opts).ok).toBe(true);
    expect(consume(KEY, opts).ok).toBe(false);

    vi.advanceTimersByTime(1_001);
    expect(consume(KEY, opts).ok).toBe(true);
  });

  it('isolates buckets per key', () => {
    const opts = { windowMs: 60_000, max: 1 };
    expect(consume('a', opts).ok).toBe(true);
    expect(consume('a', opts).ok).toBe(false);
    expect(consume('b', opts).ok).toBe(true);
  });

  it('reset() clears the bucket', () => {
    const opts = { windowMs: 60_000, max: 1 };
    expect(consume(KEY, opts).ok).toBe(true);
    expect(consume(KEY, opts).ok).toBe(false);
    reset(KEY);
    expect(consume(KEY, opts).ok).toBe(true);
  });
});
