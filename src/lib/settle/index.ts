/**
 * Greedy clearing algorithm.
 *
 * Given each member's net balance (paid − owed) in a single common currency
 * (minor units), produce a list of transfers `{from, to, amountMinor}` such
 * that after applying all transfers every member's balance becomes zero
 * (within the trivial 1-minor-unit tolerance left by integer rounding).
 *
 * Algorithm:
 *   - Pop the largest creditor C (positive net) and largest debtor D (negative
 *     net). Transfer `min(|D|, C)` from D to C, decrement both balances.
 *   - Repeat until at most one non-zero balance remains. That residual must be
 *     within ±1 minor unit (rounding noise from `lib/split`); we drop it.
 *
 * Properties:
 *   - Number of transfers ≤ N − 1 where N is the count of members with
 *     non-zero net. (Each step zeros out at least one party.)
 *   - Not necessarily the minimum possible (that's NP-hard); good enough for
 *     small social groups.
 *
 * Determinism: members with equal absolute net are ordered by `memberId`
 * ascending so output is stable.
 */

export interface Balance {
  memberId: string;
  /** paid - owed, in minor units. Positive = creditor, negative = debtor. */
  netMinor: bigint;
}

export interface Transfer {
  from: string;
  to: string;
  amountMinor: bigint;
}

export function settle(balances: readonly Balance[]): Transfer[] {
  // Defensive copy + drop zeroes.
  const work = balances
    .filter((b) => b.netMinor !== 0n)
    .map((b) => ({ ...b }));

  // Sanity: net total should be zero (or off by < N due to LRM rounding).
  const totalNet = work.reduce((a, b) => a + b.netMinor, 0n);
  if (absBig(totalNet) > BigInt(work.length)) {
    throw new Error('UNBALANCED');
  }

  const transfers: Transfer[] = [];

  while (true) {
    // Pick max creditor (largest positive) and max debtor (most negative).
    work.sort(byNetThenId);
    const debtor = work[0];
    const creditor = work[work.length - 1];
    if (!debtor || !creditor) break;
    if (debtor.netMinor >= 0n || creditor.netMinor <= 0n) break;

    const amount = creditor.netMinor < -debtor.netMinor ? creditor.netMinor : -debtor.netMinor;

    transfers.push({
      from: debtor.memberId,
      to: creditor.memberId,
      amountMinor: amount,
    });

    debtor.netMinor += amount;
    creditor.netMinor -= amount;

    // Remove zeroed entries to shrink the list (keeps loop O(N²·log N) at most).
    for (let i = work.length - 1; i >= 0; i--) {
      if (work[i]!.netMinor === 0n) work.splice(i, 1);
    }
  }

  return transfers;
}

function byNetThenId(a: Balance, b: Balance): number {
  if (a.netMinor < b.netMinor) return -1;
  if (a.netMinor > b.netMinor) return 1;
  return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
}

function absBig(x: bigint): bigint {
  return x < 0n ? -x : x;
}
