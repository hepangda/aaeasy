/**
 * Classify how an expense was split, for compact UI labels.
 *
 *   SOLO   — exactly one person owes the whole amount
 *   EQUAL  — every participant owes the same (within LRM rounding tolerance)
 *   RATIO  — owes follow a small integer ratio (e.g. 2:1:1) — detected by
 *            dividing all amounts by their GCD and checking the largest
 *            weight stays small (≤ 10).
 *   CUSTOM — anything else, including "with extra charges" — i.e. the per-
 *            member amounts cannot be expressed as a clean ratio.
 *
 * When `splitRule` is provided we trust its intent first (an explicit
 * WEIGHTED rule with uneven weights is RATIO even if the resolved minor
 * amounts happen to be all-equal). Only EXACT rules fall through to the
 * heuristic.
 */

import type { SplitRule } from './types';

export type SplitClass = 'SOLO' | 'EQUAL' | 'RATIO' | 'CUSTOM';

interface ClassifyInput {
  splits: { memberId: string; shareMinor: bigint }[];
  splitRule?: SplitRule | null;
}

const RATIO_MAX_WEIGHT = 10;

export function classifySplit({ splits, splitRule }: ClassifyInput): SplitClass {
  const nonZero = splits.filter((s) => s.shareMinor > 0n);
  if (nonZero.length === 0) return 'CUSTOM';
  if (nonZero.length === 1) return 'SOLO';

  // Trust an explicit non-EXACT rule.
  if (splitRule) {
    if (splitRule.type === 'EQUAL' || splitRule.type === 'SUBSET') return 'EQUAL';
    if (splitRule.type === 'WEIGHTED') {
      const weights = splitRule.weights
        .filter((w) => w.weight !== '0' && w.weight !== '0.0')
        .map((w) => w.weight);
      return new Set(weights).size === 1 ? 'EQUAL' : 'RATIO';
    }
    // EXACT → fall through to the numeric heuristic.
  }

  const amounts = nonZero.map((s) => s.shareMinor).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const min = amounts[0]!;
  const max = amounts[amounts.length - 1]!;

  // EQUAL within LRM tail-difference (max-min ≤ N is impossible to exceed
  // when all participants got the same fair share).
  if (max - min <= BigInt(amounts.length)) return 'EQUAL';

  // Try to spot a small integer ratio by dividing every amount by their GCD.
  let g = amounts[0]!;
  for (let i = 1; i < amounts.length; i++) g = bigGcd(g, amounts[i]!);
  if (g > 0n) {
    const weights = amounts.map((a) => a / g);
    const maxW = weights.reduce((a, b) => (a > b ? a : b));
    if (maxW <= BigInt(RATIO_MAX_WEIGHT)) return 'RATIO';
  }

  return 'CUSTOM';
}

function bigGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}
