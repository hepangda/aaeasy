export type SlidingWindowResult = {
  events: number[];
  ok: boolean;
  remaining: number;
  retryAfterMs?: number;
  nextAlarm?: number;
};

export function activeWindowEvents(events: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return events.filter((event) => event > cutoff).sort((left, right) => left - right);
}

export function consumeSlidingWindow(
  storedEvents: number[],
  now: number,
  input: { windowMs: number; max: number },
): SlidingWindowResult {
  const events = activeWindowEvents(storedEvents, now, input.windowMs);
  if (events.length >= input.max) {
    return {
      events,
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(1, events[0]! + input.windowMs - now),
      nextAlarm: events[0]! + input.windowMs,
    };
  }

  events.push(now);
  return {
    events,
    ok: true,
    remaining: input.max - events.length,
    nextAlarm: events[0]! + input.windowMs,
  };
}
