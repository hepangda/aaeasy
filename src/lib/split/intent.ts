import Decimal from 'decimal.js';
import { classifySplit, type SplitClass } from './classify';
import type { SplitInputRow, SplitInputState } from './input-state';
import type { SplitRule } from './types';

type IntentRow = Pick<SplitInputRow, 'memberId' | 'checked' | 'shares' | 'extraText'>;

export interface SplitIntent {
  kind: SplitClass;
  participantIds: string[];
  /** Integer shares reduced to their smallest ratio, in participant order. */
  ratio: number[];
}

/**
 * Describe the split method represented by the editor controls.
 *
 * The persisted split rule is intentionally EXACT, so the row inputs are the
 * only reliable source for whether the user chose equal shares, unequal
 * shares, or per-person extras. Keeping this logic in one pure function also
 * prevents the form summary and the saved-expense badge from drifting apart.
 */
export function describeSplitIntent(
  rows: readonly IntentRow[],
  participantIds?: readonly string[],
): SplitIntent {
  const ids = participantIds ? [...participantIds] : inferParticipantIds(rows);

  if (ids.length === 1) {
    return { kind: 'SOLO', participantIds: ids, ratio: [1] };
  }

  if (rows.some((row) => hasMaterialExtra(row.extraText))) {
    return { kind: 'CUSTOM', participantIds: ids, ratio: [] };
  }

  const byMemberId = new Map(rows.map((row) => [row.memberId, row]));
  const weights: number[] = [];
  for (const memberId of ids) {
    const row = byMemberId.get(memberId);
    const weight = row ? Number.parseInt(row.shares, 10) : 0;
    if (
      !row?.checked ||
      !/^\d+$/.test(row.shares) ||
      !Number.isSafeInteger(weight) ||
      weight <= 0
    ) {
      return { kind: 'CUSTOM', participantIds: ids, ratio: [] };
    }
    weights.push(weight);
  }

  if (weights.length === 0) {
    return { kind: 'CUSTOM', participantIds: ids, ratio: [] };
  }

  const divisor = weights.reduce(gcd);
  const ratio = weights.map((weight) => weight / divisor);
  const kind = new Set(ratio).size === 1 ? 'EQUAL' : 'RATIO';
  return { kind, participantIds: ids, ratio };
}

export function classifyPersistedSplit({
  splits,
  splitRule,
  splitInputState,
}: {
  splits: { memberId: string; shareMinor: bigint }[];
  splitRule?: SplitRule | null;
  splitInputState?: SplitInputState | null;
}): SplitClass {
  const participantIds = splits
    .filter((split) => split.shareMinor > 0n)
    .map((split) => split.memberId);

  if (splitInputState) {
    const inputMemberIds = new Set(splitInputState.rows.map((row) => row.memberId));
    const stateCoversEveryParticipant = participantIds.every((id) => inputMemberIds.has(id));
    if (stateCoversEveryParticipant) {
      return describeSplitIntent(splitInputState.rows).kind;
    }
  }

  return classifySplit({ splits, splitRule });
}

function inferParticipantIds(rows: readonly IntentRow[]): string[] {
  return rows
    .filter((row) => row.checked || hasMaterialExtra(row.extraText))
    .map((row) => row.memberId);
}

function hasMaterialExtra(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Match the money parser's locale-friendly zero forms before Decimal,
  // which intentionally only accepts a dot as its decimal mark.
  if (/^-?0+(?:[.,]0+)?$/.test(trimmed.replace(/[\s_]/g, ''))) return false;
  try {
    return !new Decimal(trimmed).isZero();
  } catch {
    // Invalid input is still custom input; the form surfaces its parse error
    // separately and must not misleadingly call it an equal split.
    return true;
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}
