import { DurableObject } from 'cloudflare:workers';
import type { WorkerEnv } from '../env';
import { activeWindowEvents, consumeSlidingWindow } from './rate-limit-window';

export interface RateLimitInput {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs?: number;
}

export class RateLimiter extends DurableObject<WorkerEnv> {
  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    if (!Number.isInteger(input.windowMs) || input.windowMs < 1) {
      throw new Error('INVALID_RATE_LIMIT_WINDOW');
    }
    if (!Number.isInteger(input.max) || input.max < 1) {
      throw new Error('INVALID_RATE_LIMIT_MAX');
    }
    const now = Date.now();
    const stored = (await this.ctx.storage.get<number[]>('events')) ?? [];
    const result = consumeSlidingWindow(stored, now, input);
    await this.ctx.storage.put({ events: result.events, windowMs: input.windowMs });
    if (result.nextAlarm) await this.ctx.storage.setAlarm(result.nextAlarm);
    return {
      ok: result.ok,
      remaining: result.remaining,
      ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
    };
  }

  async alarm(): Promise<void> {
    const windowMs = await this.ctx.storage.get<number>('windowMs');
    if (!windowMs) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const stored = (await this.ctx.storage.get<number[]>('events')) ?? [];
    const events = activeWindowEvents(stored, Date.now(), windowMs);
    if (events.length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.put('events', events);
    await this.ctx.storage.setAlarm(events[0]! + windowMs);
  }
}
