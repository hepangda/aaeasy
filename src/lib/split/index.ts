/**
 * Pure split computation.
 *
 * Inputs:
 *   - `totalMinor`: total amount in minor units (BigInt)
 *   - `rule`: SplitRule (EQUAL | SUBSET | WEIGHTED)
 *   - `payerMemberId`: needed only when `roundingToPayer` is set
 *
 * Output: `Map<memberId, shareMinor>` summing exactly to `totalMinor`.
 *
 * Rounding strategy:
 *   1. Compute each member's exact Decimal share = total * weight / Σweight.
 *   2. Floor each share into a "base" minor amount (toward zero for negatives,
 *      but expenses are always non-negative).
 *   3. The leftover `total − Σbase` is the "remainder" (≥ 0, < N).
 *   4. Distribute the remainder one minor unit at a time, by default using the
 *      Largest Remainder Method (members with the largest fractional part get
 *      +1 first; ties broken by stable memberId order). When
 *      `WEIGHTED.roundingToPayer === true`, the entire remainder goes to the
 *      payer instead.
 *
 * Pre-conditions:
 *   - `totalMinor >= 0n`
 *   - All referenced memberIds appear in `validMemberIds` (action layer must
 *     pass the group's current member set; this function trusts the caller).
 *   - For WEIGHTED: every weight ≥ 0, and Σ weights > 0.
 *
 * Throws on invalid inputs.
 */

import Decimal from 'decimal.js';
import type { SplitRule } from './types';

export interface SplitOptions {
  totalMinor: bigint;
  rule: SplitRule;
  payerMemberId?: string;
  /**
   * Set of memberIds that are still valid in the group. If provided,
   * any reference to a memberId not in this set throws. Optional so that
   * unit tests can call without a roster.
   */
  validMemberIds?: ReadonlySet<string>;
}

export type SplitResult = Map<string, bigint>;

export class SplitError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'SplitError';
  }
}

export function computeSplit(opts: SplitOptions): SplitResult {
  const { totalMinor, rule, payerMemberId, validMemberIds } = opts;
  if (totalMinor < 0n) throw new SplitError('TOTAL_NEGATIVE');

  // EXACT: amounts come pre-resolved from the form; we just validate and
  // return them. Sum MUST equal totalMinor — otherwise the form has a bug or
  // the data was tampered with.
  if (rule.type === 'EXACT') {
    const seen = new Set<string>();
    const out: SplitResult = new Map();
    let sum = 0n;
    for (const a of rule.amounts) {
      if (seen.has(a.memberId)) throw new SplitError('DUPLICATE_MEMBER');
      seen.add(a.memberId);
      if (validMemberIds && !validMemberIds.has(a.memberId)) {
        throw new SplitError('UNKNOWN_MEMBER');
      }
      const v = BigInt(a.amountMinor);
      if (v < 0n) throw new SplitError('NEGATIVE_AMOUNT');
      if (v > 0n) {
        out.set(a.memberId, v);
        sum += v;
      }
    }
    if (out.size === 0) throw new SplitError('NO_PARTICIPANTS');
    if (sum !== totalMinor) throw new SplitError('SUM_MISMATCH');
    void payerMemberId;
    return out;
  }

  const { memberIds, weights } = normalize(rule);

  if (memberIds.length === 0) throw new SplitError('NO_PARTICIPANTS');
  // Stable order for deterministic tail-difference allocation.
  const ordered = [...memberIds].sort();
  // Map original membership to ordered index for weight lookup.
  const weightByMember = new Map<string, Decimal>();
  for (let i = 0; i < memberIds.length; i++) {
    weightByMember.set(memberIds[i]!, weights[i]!);
  }

  if (validMemberIds) {
    for (const m of ordered) {
      if (!validMemberIds.has(m)) throw new SplitError('UNKNOWN_MEMBER');
    }
  }

  // Sum of weights
  const sumW = weights.reduce((a, b) => a.plus(b), new Decimal(0));
  if (!sumW.isFinite() || sumW.lte(0)) throw new SplitError('ZERO_WEIGHT');

  const total = new Decimal(totalMinor.toString()); // exact integer

  // Compute floor share + fractional part per member.
  type Row = { id: string; base: bigint; frac: Decimal };
  const rows: Row[] = ordered.map((id) => {
    const w = weightByMember.get(id)!;
    if (w.isNegative()) throw new SplitError('NEGATIVE_WEIGHT');
    const exact = total.times(w).div(sumW);
    const floor = exact.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    const frac = exact.minus(floor);
    return { id, base: BigInt(floor.toFixed(0)), frac };
  });

  const baseSum = rows.reduce((a, r) => a + r.base, 0n);
  let remainder = totalMinor - baseSum;

  if (remainder < 0n) throw new SplitError('INTERNAL_ROUND_OVER'); // shouldn't happen with FLOOR

  const out: SplitResult = new Map();
  for (const r of rows) out.set(r.id, r.base);

  if (remainder === 0n) return out;

  const toPayer =
    rule.type === 'WEIGHTED' && rule.roundingToPayer === true && payerMemberId
      ? payerMemberId
      : null;

  if (toPayer && out.has(toPayer)) {
    out.set(toPayer, out.get(toPayer)! + remainder);
    return out;
  }

  // Largest Remainder Method: sort by frac desc, break ties by id asc (rows
  // are already id-asc, so a stable sort by frac desc preserves it).
  const ranked = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const cmp = b.r.frac.cmp(a.r.frac);
      return cmp !== 0 ? cmp : a.i - b.i;
    });

  let i = 0;
  while (remainder > 0n) {
    const id = ranked[i % ranked.length]!.r.id;
    out.set(id, out.get(id)! + 1n);
    remainder--;
    i++;
  }
  return out;
}

function normalize(rule: SplitRule): { memberIds: string[]; weights: Decimal[] } {
  switch (rule.type) {
    case 'EQUAL':
    case 'SUBSET': {
      const ids = uniq(rule.memberIds);
      return { memberIds: ids, weights: ids.map(() => new Decimal(1)) };
    }
    case 'WEIGHTED': {
      const seen = new Set<string>();
      const ids: string[] = [];
      const weights: Decimal[] = [];
      for (const w of rule.weights) {
        if (seen.has(w.memberId)) throw new SplitError('DUPLICATE_MEMBER');
        seen.add(w.memberId);
        const wd = new Decimal(w.weight);
        if (wd.isNegative()) throw new SplitError('NEGATIVE_WEIGHT');
        if (!wd.isFinite()) throw new SplitError('WEIGHT_INFINITE');
        if (wd.eq(0)) continue; // 0 weight = excluded
        ids.push(w.memberId);
        weights.push(wd);
      }
      return { memberIds: ids, weights };
    }
    case 'EXACT':
      // Handled separately at the top of computeSplit; never reaches here.
      throw new SplitError('UNREACHABLE');
  }
}

function uniq(xs: readonly string[]): string[] {
  return Array.from(new Set(xs));
}
