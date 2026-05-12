import { describe, expect, it } from 'vitest';
import { settle, type Balance } from './index';

function applyTransfers(balances: Balance[], transfers: { from: string; to: string; amountMinor: bigint }[]): Map<string, bigint> {
  const m = new Map(balances.map((b) => [b.memberId, b.netMinor]));
  for (const t of transfers) {
    m.set(t.from, m.get(t.from)! + t.amountMinor);
    m.set(t.to, m.get(t.to)! - t.amountMinor);
  }
  return m;
}

function allZero(m: Map<string, bigint>): boolean {
  for (const v of m.values()) if (v !== 0n) return false;
  return true;
}

describe('settle', () => {
  it('returns empty for all-zero', () => {
    expect(settle([])).toEqual([]);
    expect(
      settle([
        { memberId: 'a', netMinor: 0n },
        { memberId: 'b', netMinor: 0n },
      ]),
    ).toEqual([]);
  });

  it('handles 2-party debt', () => {
    const b: Balance[] = [
      { memberId: 'a', netMinor: 1000n }, // a is owed 1000
      { memberId: 'b', netMinor: -1000n }, // b owes 1000
    ];
    const t = settle(b);
    expect(t).toEqual([{ from: 'b', to: 'a', amountMinor: 1000n }]);
    expect(allZero(applyTransfers(b, t))).toBe(true);
  });

  it('handles classic 3-way: A paid 90, B paid 0, C paid 0; equally owed 30 each', () => {
    // A net = 90 - 30 = 60. B net = -30. C net = -30.
    const b: Balance[] = [
      { memberId: 'a', netMinor: 60n },
      { memberId: 'b', netMinor: -30n },
      { memberId: 'c', netMinor: -30n },
    ];
    const t = settle(b);
    // ≤ N-1 = 2 transfers
    expect(t.length).toBeLessThanOrEqual(2);
    expect(allZero(applyTransfers(b, t))).toBe(true);
    // Both transfers should go TO a
    for (const tr of t) expect(tr.to).toBe('a');
  });

  it('chain debt collapses to one transfer if possible', () => {
    // A owes B 50; B owes C 50 → net: A=-50, B=0, C=+50
    const b: Balance[] = [
      { memberId: 'a', netMinor: -50n },
      { memberId: 'b', netMinor: 0n },
      { memberId: 'c', netMinor: 50n },
    ];
    const t = settle(b);
    expect(t).toEqual([{ from: 'a', to: 'c', amountMinor: 50n }]);
  });

  it('respects ≤ N-1 transfer bound for 5 members', () => {
    const b: Balance[] = [
      { memberId: 'a', netMinor: 100n },
      { memberId: 'b', netMinor: 50n },
      { memberId: 'c', netMinor: -30n },
      { memberId: 'd', netMinor: -70n },
      { memberId: 'e', netMinor: -50n },
    ];
    const t = settle(b);
    expect(t.length).toBeLessThanOrEqual(4); // N-1
    expect(allZero(applyTransfers(b, t))).toBe(true);
  });

  it('handles 10 members with mixed nets — invariant: zero balance after, ≤ 9 transfers', () => {
    let seed = 1234;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let trial = 0; trial < 30; trial++) {
      const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
      const raw = ids.map((id) => ({
        memberId: id,
        netMinor: BigInt(Math.floor((rand() - 0.5) * 200_000)),
      }));
      // Force net to zero by adjusting the last entry.
      const total = raw.reduce((a, b) => a + b.netMinor, 0n);
      raw[raw.length - 1]!.netMinor -= total;

      const t = settle(raw);
      expect(t.length).toBeLessThanOrEqual(9);
      expect(allZero(applyTransfers(raw, t))).toBe(true);
    }
  });

  it('throws if balances are wildly unbalanced', () => {
    expect(() =>
      settle([
        { memberId: 'a', netMinor: 1_000_000n },
        { memberId: 'b', netMinor: 0n },
      ]),
    ).toThrow(/UNBALANCED/);
  });

  it('produces deterministic output for ties', () => {
    const b: Balance[] = [
      { memberId: 'b', netMinor: -50n },
      { memberId: 'a', netMinor: -50n },
      { memberId: 'c', netMinor: 100n },
    ];
    const t1 = settle(b);
    const t2 = settle(b);
    expect(t1).toEqual(t2);
    // Tied debtors should be paid off in id-asc order.
    expect(t1[0]!.from).toBe('a');
  });
});
