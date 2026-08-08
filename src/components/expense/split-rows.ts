import { computeSplit } from '@aaeasy/core/split';
import { formatMinor } from '@aaeasy/core/money';
import type { SplitInputState } from '@aaeasy/core/split-input-state';
import type { SplitRule } from '@aaeasy/core/split-types';
import { parseMajorMinor, parseSignedMajorMinor } from '@/lib/split/allocate';

export interface Member {
  id: string;
  displayName: string;
}

/** One row of the split editor, as the user typed it. */
export interface SplitRow {
  memberId: string;
  checked: boolean;
  /** Integer share count for proportional fill. Empty string = "0". */
  shares: string;
  /** Base share, in MAJOR units, as a free-form text the user can edit. */
  baseText: string;
  /**
   * Extra amount that goes 100% to this member, in MAJOR units. May be
   * negative — e.g. a refund or per-person discount that increases the
   * base pool everyone else shares.
   */
  extraText: string;
}

/**
 * Build the initial rows from the user's last-saved form state when available,
 * otherwise reconstruct from the persisted SplitRule:
 *   - EQUAL / SUBSET → checked members, shares=1, extras blank.
 *   - WEIGHTED with integer weights → shares=weight, extras blank.
 *   - WEIGHTED with non-integer weights, or EXACT → each member's resolved
 *     amount lands in `extraText`, shares=0; the user can rebalance from
 *     there or click "Equal-split all" to start over.
 *   - null rule (brand-new expense) → everyone checked, shares=1, extras blank.
 */
export function rowsFromDefaults(
  state: SplitInputState | null,
  rule: SplitRule | null,
  members: Member[],
  totalMinor: bigint,
  currency: string,
): SplitRow[] {
  if (state) {
    const byMember = new Map(state.rows.map((r) => [r.memberId, r]));
    return members.map((m) => {
      const r = byMember.get(m.id);
      if (!r) {
        return { memberId: m.id, checked: false, shares: '0', baseText: '', extraText: '' };
      }
      return {
        memberId: m.id,
        checked: r.checked,
        shares: r.shares || (r.checked ? '1' : '0'),
        baseText: '',
        extraText: r.extraText,
      };
    });
  }
  if (!rule) {
    return members.map((m) => ({
      memberId: m.id,
      checked: true,
      shares: '1',
      baseText: '',
      extraText: '',
    }));
  }
  if (rule.type === 'EQUAL' || rule.type === 'SUBSET') {
    const set = new Set(rule.memberIds);
    return members.map((m) => {
      const inUse = set.has(m.id);
      return {
        memberId: m.id,
        checked: inUse,
        shares: inUse ? '1' : '0',
        baseText: '',
        extraText: '',
      };
    });
  }
  if (rule.type === 'WEIGHTED') {
    const byMember = new Map(rule.weights.map((w) => [w.memberId, w.weight]));
    const allInteger = rule.weights.every((w) => /^\d+$/.test(w.weight));
    if (allInteger) {
      return members.map((m) => {
        const w = byMember.get(m.id);
        const n = w ? parseInt(w, 10) : 0;
        return {
          memberId: m.id,
          checked: n > 0,
          shares: n > 0 ? String(n) : '0',
          baseText: '',
          extraText: '',
        };
      });
    }
    // Fall through: treat decimal weights like EXACT below (preserve by
    // dropping into the extras column).
  }
  // EXACT (and any non-integer WEIGHTED): each member's resolved amount
  // goes into `extra` so the totals immediately reconcile and the user can
  // tweak per-person numbers directly.
  const amountByMember = new Map<string, bigint>();
  if (rule.type === 'EXACT') {
    for (const a of rule.amounts) amountByMember.set(a.memberId, BigInt(a.amountMinor));
  } else if (rule.type === 'WEIGHTED' && totalMinor > 0n) {
    try {
      const computed = computeSplit({
        totalMinor,
        rule,
        validMemberIds: new Set(members.map((m) => m.id)),
      });
      for (const [memberId, share] of computed) {
        amountByMember.set(memberId, share);
      }
    } catch {
      // best effort — leave the form blank if compute fails
    }
  }
  return members.map((m) => {
    const amt = amountByMember.get(m.id) ?? 0n;
    return {
      memberId: m.id,
      checked: false,
      shares: '0',
      baseText: '',
      extraText: amt > 0n ? formatMinor(amt, currency) : '',
    };
  });
}

/**
 * What each member ends up owing: `(checked ? base : 0) + extra`. Extras count
 * for everyone, checked or not.
 */
export function totalsFromRows(rows: readonly SplitRow[], currency: string) {
  let sumMinor = 0n;
  let anyParseError = false;
  const perMemberFinal: bigint[] = rows.map((row) => {
    const extra = parseSignedMajorMinor(row.extraText, currency);
    if (extra === null) {
      anyParseError = true;
      return 0n;
    }
    let base = 0n;
    if (row.checked) {
      const parsed = parseMajorMinor(row.baseText, currency);
      if (parsed === null) {
        anyParseError = true;
        return 0n;
      }
      base = parsed;
    }
    const value = base + extra;
    if (value < 0n) {
      anyParseError = true;
      return 0n;
    }
    sumMinor += value;
    return value;
  });
  return { sumMinor, perMemberFinal, anyParseError };
}

/** Set every row's share count in lockstep. */
export function toggleAllRows(rows: readonly SplitRow[]): SplitRow[] {
  const allChecked = rows.every((row) => row.checked);
  return rows.map((row) => {
    if (allChecked) return { ...row, checked: false, shares: '0' };
    const n = parseInt(row.shares || '0', 10);
    return { ...row, checked: true, shares: Number.isFinite(n) && n > 0 ? String(n) : '1' };
  });
}

/** Reset the checked rows to a clean equal share. */
export function equalSplitRows(rows: readonly SplitRow[]): SplitRow[] {
  const anyChecked = rows.some((row) => row.checked);
  if (!anyChecked) {
    return rows.map((row) => ({ ...row, checked: true, shares: '1', extraText: '' }));
  }
  return rows.map((row) => (row.checked ? { ...row, shares: '1', extraText: '' } : row));
}

/**
 * Set one row's share count, keeping the "checked ↔ shares > 0" invariant:
 * a row with no weight is unchecked rather than left to drag the totals out of
 * balance.
 */
export function withShares(rows: readonly SplitRow[], memberId: string, next: number): SplitRow[] {
  return rows.map((row) => {
    if (row.memberId !== memberId) return row;
    const clamped = Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0;
    if (clamped === 0) return { ...row, checked: false, shares: '0' };
    return { ...row, checked: true, shares: String(clamped) };
  });
}

/** Toggle one row, bumping a zero-share row back to 1 when it is checked. */
export function withChecked(
  rows: readonly SplitRow[],
  memberId: string,
  checked: boolean,
): SplitRow[] {
  return rows.map((row) => {
    if (row.memberId !== memberId) return row;
    if (!checked) return { ...row, checked: false, shares: '0' };
    const n = parseInt(row.shares || '0', 10);
    return { ...row, checked: true, shares: Number.isFinite(n) && n > 0 ? String(n) : '1' };
  });
}
