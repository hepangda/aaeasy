import { describe, expect, it } from 'vitest';
import { __test } from './ai-parse-stream';
import type { ParseStreamEvent } from './ai-schema';

const { FieldEmitter, parseOpenAiSseFrame } = __test;

const MEMBERS = [
  { id: 'm-alice', displayName: 'Alice' },
  { id: 'm-bob', displayName: 'Bob' },
  { id: 'm-carol', displayName: 'Carol' },
];

function feedAll(emitter: InstanceType<typeof FieldEmitter>, chunks: string[]) {
  const events: ParseStreamEvent[] = [];
  for (const ch of chunks) {
    for (const ev of emitter.feed(ch)) events.push(ev);
  }
  for (const ev of emitter.flush()) events.push(ev);
  return events;
}

describe('FieldEmitter', () => {
  it('emits each top-level scalar as it completes', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, [
      '{"title": "Lunch", "occurredAt": "2026-06-08", "amount": "87.50"}',
    ]);
    expect(events.filter((x) => x.type === 'field')).toEqual([
      { type: 'field', name: 'title', value: 'Lunch' },
      { type: 'field', name: 'occurredAt', value: '2026-06-08' },
      { type: 'field', name: 'amount', value: '87.50' },
    ]);
  });

  it('handles chunks that split a string literal', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, [
      '{"title": "Lun',
      'ch with',
      ' Alice", "amount": 100}',
    ]);
    const titles = events.filter(
      (x): x is Extract<ParseStreamEvent, { type: 'field' }> =>
        x.type === 'field' && x.name === 'title',
    );
    expect(titles).toHaveLength(1);
    expect(titles[0]?.value).toBe('Lunch with Alice');
    const amounts = events.filter(
      (x): x is Extract<ParseStreamEvent, { type: 'field' }> =>
        x.type === 'field' && x.name === 'amount',
    );
    expect(amounts[0]?.value).toBe('100');
  });

  it('resolves payerName to memberId', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, [
      '{"payerName": "alice"}',
    ]);
    expect(events.find((x) => x.type === 'field' && x.name === 'payerMemberId')).toEqual({
      type: 'field',
      name: 'payerMemberId',
      value: 'm-alice',
    });
  });

  it('reports unresolved payer in flush META event', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, ['{"payerName": "Dave"}']);
    const meta = events.find((x) => x.type === 'meta');
    expect(meta).toEqual({
      type: 'meta',
      unresolved: { payerName: 'Dave' },
    });
  });

  it('emits a split event for a nested object', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, [
      '{"split": {"mode": "equal", "participants": ["Alice", "Bob"]}}',
    ]);
    const split = events.find((x) => x.type === 'split');
    expect(split?.type).toBe('split');
    if (split?.type === 'split') {
      expect(split.mode).toBe('equal');
      expect(split.rows.find((r) => r.memberId === 'm-alice')?.checked).toBe(true);
      expect(split.rows.find((r) => r.memberId === 'm-bob')?.checked).toBe(true);
      expect(split.rows.find((r) => r.memberId === 'm-carol')?.checked).toBe(false);
    }
  });

  it('skips null values silently', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, [
      '{"title": null, "amount": "50"}',
    ]);
    const fields = events.filter((x) => x.type === 'field');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual({ type: 'field', name: 'amount', value: '50' });
  });

  it('drops bogus field values without breaking the stream', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, [
      // amount has bad chars after normalization
      '{"amount": "abc", "title": "Coffee"}',
    ]);
    const fields = events.filter((x) => x.type === 'field');
    expect(fields).toEqual([
      { type: 'field', name: 'title', value: 'Coffee' },
    ]);
  });

  it('clamps currency suggestions to ISO codes', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, ['{"currency": "us"}']);
    expect(events.filter((x) => x.type === 'field')).toEqual([]);
  });

  it('handles JSON spread across many tiny chunks', () => {
    const e = new FieldEmitter(MEMBERS);
    const payload = '{"title": "Pizza", "amount": "42.0", "payerName": "Bob"}';
    const events = feedAll(e, payload.split(''));
    const names = events
      .filter((x) => x.type === 'field')
      .map((x) => (x as { name: string }).name);
    expect(names).toEqual(['title', 'amount', 'payerMemberId']);
  });

  it('ignores unknown top-level keys', () => {
    const e = new FieldEmitter(MEMBERS);
    const events = feedAll(e, [
      '{"mysteryField": "hi", "title": "Tea"}',
    ]);
    expect(events.filter((x) => x.type === 'field')).toEqual([
      { type: 'field', name: 'title', value: 'Tea' },
    ]);
  });
});

describe('parseOpenAiSseFrame', () => {
  it('extracts the delta content from an OpenAI chunk', () => {
    const frame =
      'data: {"choices":[{"delta":{"content":"hel"}}]}';
    expect(parseOpenAiSseFrame(frame)).toBe('hel');
  });

  it('recognizes [DONE]', () => {
    expect(parseOpenAiSseFrame('data: [DONE]')).toBe(
      // SSE_DONE is an opaque Symbol exported indirectly via the function's
      // return type; comparing identity through `===` requires reaching into
      // the module, so we just assert it's not a string and not null.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parseOpenAiSseFrame('data: [DONE]') as any),
    );
    const out = parseOpenAiSseFrame('data: [DONE]');
    expect(typeof out).toBe('symbol');
  });

  it('skips comment lines', () => {
    const frame = ': hb';
    expect(parseOpenAiSseFrame(frame)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseOpenAiSseFrame('data: not-json')).toBeNull();
  });
});
