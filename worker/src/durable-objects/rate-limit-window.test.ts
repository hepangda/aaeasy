import { describe, expect, it } from 'vitest';
import { activeWindowEvents, consumeSlidingWindow } from './rate-limit-window';

describe('sliding-window rate limit', () => {
  it('drops an event exactly at the window boundary', () => {
    expect(activeWindowEvents([1_000, 1_001], 2_000, 1_000)).toEqual([1_001]);
  });

  it('preserves later valid events when the oldest alarm fires', () => {
    expect(activeWindowEvents([1_000, 1_500], 2_000, 1_000)).toEqual([1_500]);
  });

  it('returns retry timing without appending a blocked event', () => {
    expect(consumeSlidingWindow([1_500, 1_700], 2_000, { windowMs: 1_000, max: 2 })).toEqual({
      events: [1_500, 1_700],
      ok: false,
      remaining: 0,
      retryAfterMs: 500,
      nextAlarm: 2_500,
    });
  });
});
