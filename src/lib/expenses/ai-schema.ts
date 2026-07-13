/**
 * Shared schemas, types, and normalization helpers for AI-assisted expense
 * parsing. Both the non-streaming `aiParseExpense` and the streaming
 * `aiParseExpenseStream` import from here so they can't drift apart.
 */

import { z } from 'zod';
import { isCurrencyCode } from '@/lib/money';
import type { SplitInputRow } from '@/lib/split/input-state';

export type AiParseErrorCode =
  | 'NOT_CONFIGURED'
  | 'EMPTY_INPUT'
  | 'TOO_LONG'
  | 'IMAGE_UNSUPPORTED'
  | 'UPSTREAM_FAILED'
  | 'UPSTREAM_INVALID'
  | 'TIMEOUT'
  | 'STREAM_INTERRUPTED'
  | 'RATE_LIMITED'
  | 'INVALID_JSON'
  | 'INVALID_BODY'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN';

export class AiParseError extends Error {
  constructor(
    public code: AiParseErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type ParseFieldName =
  | 'title'
  | 'occurredAt'
  | 'currency'
  | 'amount'
  | 'payerMemberId'
  | 'note'
  | 'fxRateOverride'
  | 'isDraft'
  | 'tags'
  | 'reasoning'
  | 'ambiguousHint';

export type ParseStreamEvent =
  | { type: 'field'; name: ParseFieldName; value: unknown }
  | {
      type: 'split';
      mode: 'equal' | 'shares' | 'custom';
      rows: SplitInputRow[];
    }
  | {
      type: 'meta';
      unresolved: { payerName?: string; participants?: string[] };
    }
  | { type: 'done'; tookMs: number }
  | { type: 'error'; code: AiParseErrorCode; detail?: string };

/**
 * v2 wire schema. Every field is nullable + optional so a partial extraction
 * never invalidates the whole response. Key declaration order is the order
 * we ask the model to emit, picked so the cheap/important fields land first
 * for a snappier streaming experience.
 */
export const aiResponseSchemaV2 = z.object({
  title: z.string().max(120).nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  payerName: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  isDraft: z.boolean().nullable().optional(),
  fxRateOverride: z.union([z.string(), z.number()]).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).nullable().optional(),
  reasoning: z.string().max(300).nullable().optional(),
  ambiguousHint: z.string().max(300).nullable().optional(),
  split: z
    .object({
      mode: z.enum(['equal', 'shares', 'custom']).nullable().optional(),
      participants: z.array(z.string()).max(200).nullable().optional(),
      shares: z
        .record(z.string(), z.union([z.number(), z.string()]))
        .nullable()
        .optional(),
      extras: z
        .record(z.string(), z.union([z.number(), z.string()]))
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

export type AiResponseV2 = z.infer<typeof aiResponseSchemaV2>;

export type CurrentSnapshot = {
  title?: string | null;
  occurredAt?: string | null;
  currency?: string | null;
  amount?: string | null;
  payerMemberId?: string | null;
  note?: string | null;
  isDraft?: boolean;
  splitRows?: {
    memberId: string;
    checked: boolean;
    shares: string;
    extraText: string;
  }[];
  fxRateOverride?: string | null;
};

export const currentSnapshotSchema = z.object({
  title: z.string().max(500).nullable().optional(),
  occurredAt: z.string().max(40).nullable().optional(),
  currency: z.string().max(8).nullable().optional(),
  amount: z.string().max(40).nullable().optional(),
  payerMemberId: z.string().max(40).nullable().optional(),
  note: z.string().max(2_000).nullable().optional(),
  isDraft: z.boolean().optional(),
  splitRows: z
    .array(
      z.object({
        memberId: z.string().min(1).max(40),
        checked: z.boolean(),
        shares: z.string().max(12),
        extraText: z.string().max(32),
      }),
    )
    .max(200)
    .optional(),
  fxRateOverride: z.string().max(40).nullable().optional(),
});

// ─── Field normalizers ──────────────────────────────────────────────
// All inputs are the raw value pulled from the model's JSON; outputs are
// the canonical types the form expects.

export function normalizeTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

export function normalizeNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

export function normalizeShortText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export function normalizeOccurredAt(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  return m ? (m[1] ?? null) : null;
}

export function normalizeCurrency(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase();
  return isCurrencyCode(c) ? c : null;
}

export function normalizeAmount(v: unknown): string | null {
  if (v == null) return null;
  const raw = String(v)
    .trim()
    .replace(/[^\d.]/g, '');
  if (!raw) return null;
  return /^\d+(\.\d+)?$/.test(raw) ? raw : null;
}

export function normalizeFxRate(v: unknown): string | null {
  if (v == null) return null;
  const raw = String(v)
    .trim()
    .replace(/[^\d.]/g, '');
  if (!raw) return null;
  return /^\d+(\.\d+)?$/.test(raw) ? raw : null;
}

export function normalizeBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

export function normalizeTags(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t.slice(0, 40));
    if (out.length >= 20) break;
  }
  return out.length ? out : null;
}

// ─── Member name → id resolution ────────────────────────────────────

export function resolveMemberId(
  name: string,
  members: { id: string; displayName: string }[],
): string | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const exact = members.find((m) => m.displayName.toLowerCase() === want);
  if (exact) return exact.id;
  const partial = members.find((m) => m.displayName.toLowerCase().includes(want));
  return partial ? partial.id : null;
}

// ─── Split block → SplitInputRow[] ──────────────────────────────────

export interface BuildSplitRowsInput {
  members: { id: string; displayName: string }[];
  split: NonNullable<AiResponseV2['split']>;
}

export interface BuildSplitRowsResult {
  mode: 'equal' | 'shares' | 'custom';
  rows: SplitInputRow[];
  unresolvedParticipants: string[];
}

/**
 * Map the model's name-keyed split block to per-member rows the form's
 * split editor can consume directly. Unknown names are dropped silently
 * and surfaced via `unresolvedParticipants`.
 *
 * - `equal`:  participants (or all members if omitted) → checked, shares='1'.
 * - `shares`: any member with a positive weight → checked, shares=<int>.
 *             extras carried through as raw strings.
 * - `custom`: every member becomes unchecked with shares='0'; per-member
 *             extras hold the explicit amount. Mirrors the form's
 *             "non-integer WEIGHTED falls into extras" fallback.
 */
export function buildSplitRows({ members, split }: BuildSplitRowsInput): BuildSplitRowsResult {
  const mode = (split.mode ?? 'equal') as 'equal' | 'shares' | 'custom';

  const sharesByMember = new Map<string, number>();
  const extrasByMember = new Map<string, string>();
  const unresolved: string[] = [];

  if (split.shares) {
    for (const [name, raw] of Object.entries(split.shares)) {
      const id = resolveMemberId(name, members);
      if (!id) {
        unresolved.push(name);
        continue;
      }
      const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
      if (Number.isFinite(n) && n > 0) sharesByMember.set(id, Math.floor(n));
    }
  }

  if (split.extras) {
    for (const [name, raw] of Object.entries(split.extras)) {
      const id = resolveMemberId(name, members);
      if (!id) {
        unresolved.push(name);
        continue;
      }
      const s = String(raw).trim();
      if (s) extrasByMember.set(id, s);
    }
  }

  const participantIds = new Set<string>();
  if (split.participants && split.participants.length > 0) {
    for (const name of split.participants) {
      const id = resolveMemberId(name, members);
      if (!id) {
        unresolved.push(name);
        continue;
      }
      participantIds.add(id);
    }
  } else if (mode === 'equal' && sharesByMember.size === 0) {
    for (const m of members) participantIds.add(m.id);
  }

  const rows: SplitInputRow[] = members.map((m) => {
    const extra = extrasByMember.get(m.id) ?? '';
    if (mode === 'custom') {
      return {
        memberId: m.id,
        checked: false,
        shares: '0',
        extraText: extra,
      };
    }
    if (mode === 'shares') {
      const n = sharesByMember.get(m.id) ?? 0;
      return {
        memberId: m.id,
        checked: n > 0,
        shares: n > 0 ? String(n) : '0',
        extraText: extra,
      };
    }
    // equal
    const inSplit = participantIds.has(m.id);
    return {
      memberId: m.id,
      checked: inSplit,
      shares: inSplit ? '1' : '0',
      extraText: extra,
    };
  });

  return {
    mode,
    rows,
    unresolvedParticipants: dedupe(unresolved),
  };
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Merge AI-provided rows into existing form rows, matched by memberId.
 * Touches only `checked`, `shares`, `extraText`; preserves other row fields
 * (e.g. `baseText`, which the form recomputes).
 */
export function mergeAiRows<
  R extends { memberId: string; checked: boolean; shares: string; extraText: string },
>(prev: R[], ai: SplitInputRow[]): R[] {
  const byId = new Map(ai.map((r) => [r.memberId, r]));
  return prev.map((r) => {
    const incoming = byId.get(r.memberId);
    if (!incoming) return r;
    return {
      ...r,
      checked: incoming.checked,
      shares: incoming.shares,
      extraText: incoming.extraText,
    };
  });
}
