'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Decimal from 'decimal.js';
import { Minus, Paperclip, Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createExpenseAction,
  updateExpenseAction,
  type ExpenseActionState,
} from '@/lib/expenses/actions';
import {
  errorToast,
  showI18nError,
} from '@/lib/ui/toast';
import type { SplitRule } from '@/lib/split/types';
import type { SplitInputState } from '@/lib/split/input-state';
import { computeSplit } from '@/lib/split';
import {
  decimalToMinor,
  formatMinor,
  minorToDecimal,
  minorUnits,
  parseAmountToMinor,
} from '@/lib/money';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_AI_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
]);

type Member = { id: string; displayName: string };
type AiImageContext = { name: string; mime: string; dataUrl: string };

interface Props {
  groupId: string;
  groupCurrency: string;
  members: Member[];
  /** When set, the payer field is locked to this member. Used by per-member
   *  share links. */
  lockedPayerMemberId?: string;
  defaults?: {
    expenseId: string;
    occurredAt: Date;
    title: string;
    note: string | null;
    currency: string;
    amountText: string;
    amountMinor: bigint;
    payerMemberId: string;
    splitRule: SplitRule;
    /** Raw form state captured at last save. When present, the editor
     *  restores the exact controls the user typed. Falls back to a smart
     *  reconstruction from `splitRule` when null (legacy rows). */
    splitInputState: SplitInputState | null;
    fxRateOverride?: string | null;
    /** True if the existing expense is a DRAFT (no amount yet). */
    isDraft?: boolean;
  };
}

const initial: ExpenseActionState = { ok: false };

function todayLocalISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

interface SplitRow {
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

function parseMajorMinor(text: string, currency: string): bigint | null {
  const t = text.trim();
  if (!t) return 0n;
  try {
    return parseAmountToMinor(t, currency);
  } catch {
    return null;
  }
}

/**
 * Same as `parseMajorMinor` but accepts a leading `-` so the extras column
 * can record refunds / discounts as negative amounts.
 */
function parseSignedMajorMinor(text: string, currency: string): bigint | null {
  const t = text.trim();
  if (!t) return 0n;
  const negative = t.startsWith('-');
  const body = negative ? t.slice(1).trim() : t;
  if (!body) return null;
  try {
    const v = parseAmountToMinor(body, currency);
    return negative ? -v : v;
  } catch {
    return null;
  }
}

/**
 * Distribute `total` minor units across `weights` using LRM tail diff.
 * Returns one minor-unit bigint per input weight (parallel array). Inputs with
 * zero weight get 0.
 */
function distribute(total: bigint, weights: number[]): bigint[] {
  if (total <= 0n) return weights.map(() => 0n);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0n);
  const totalD = new Decimal(total.toString());
  const sumD = new Decimal(sum);
  const rows = weights.map((w, i) => {
    const exact = totalD.times(w).div(sumD);
    const floor = exact.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    return { i, base: BigInt(floor.toFixed(0)), frac: exact.minus(floor) };
  });
  let remainder = total - rows.reduce((a, r) => a + r.base, 0n);
  // Largest fractional part wins; ties broken by index for determinism.
  const ranked = rows
    .slice()
    .sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);
  let k = 0;
  while (remainder > 0n) {
    rows[ranked[k % ranked.length]!.i]!.base += 1n;
    remainder--;
    k++;
  }
  return rows.map((r) => r.base);
}

/**
 * Build the initial SplitRow[] from the user's last-saved form state when
 * available, otherwise reconstruct from the persisted SplitRule:
 *   - EQUAL / SUBSET → checked members, shares=1, extras blank.
 *   - WEIGHTED with integer weights → shares=weight, extras blank.
 *   - WEIGHTED with non-integer weights, or EXACT → each member's resolved
 *     amount lands in `extraText`, shares=0; the user can rebalance from
 *     there or click "Equal-split all" to start over.
 *   - null rule (brand-new expense) → everyone checked, shares=1, extras blank.
 */
function rowsFromDefaults(
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

export function ExpenseForm({
  groupId,
  groupCurrency,
  members,
  lockedPayerMemberId,
  defaults,
}: Props) {
  const t = useTranslations();
  const router = useRouter();
  const action = defaults ? updateExpenseAction : createExpenseAction;
  const [state, formAction, pending] = useActionState(action, initial);

  useEffect(() => {
    if (state.error) showI18nError(t, state.error);
  }, [state.error, t]);

  // ─── Top-level fields (controlled so split logic can react) ─────────
  const [currency, setCurrency] = useState(defaults?.currency ?? groupCurrency);
  const [amountText, setAmountText] = useState(defaults?.amountText ?? '');  // DRAFT mode: hides the amount / fx / split UI entirely. The action layer
  // sees `isDraft=true` and persists the row without an amount, leaving the
  // payer to fill it in later via the group page's quick-fill panel.
  //
  // For an existing materialized expense we never offer the toggle (would
  // amount to a destructive "demote"); for a new entry, default OFF.
  const lockedNonDraft = !!defaults && defaults.isDraft === false;
  const [isDraftMode, setIsDraftMode] = useState<boolean>(
    lockedNonDraft ? false : (defaults?.isDraft ?? false),
  );
  // Parse the total amount in real time. `null` = invalid input.
  const totalMinor = useMemo<bigint | null>(() => {
    if (!amountText.trim()) return null;
    return parseMajorMinor(amountText, currency);
  }, [amountText, currency]);

  // ─── Split rows ─────────────────────────────────────────────────────
  const [rows, setRows] = useState<SplitRow[]>(() =>
    rowsFromDefaults(
      defaults?.splitInputState ?? null,
      defaults?.splitRule ?? null,
      members,
      defaults?.amountMinor ?? 0n,
      defaults?.currency ?? groupCurrency,
    ),
  );

  // If the currency changes, formatting of base/extra columns should follow
  // (different minor-unit precision). For simplicity we just re-format them
  // if they were valid in the previous currency.
  // (Skipped: the split rebalances on user click anyway.)

  function updateRow(memberId: string, patch: Partial<SplitRow>) {
    setRows((cur) => cur.map((r) => (r.memberId === memberId ? { ...r, ...patch } : r)));
  }

  // Mode is fixed to "share-based"; everyone always contributes by integer
  // `shares` (1 by default). Equal split is just shares=1 across selected
  // members, surfaced as a one-click button below.

  // Recompute the `base` column whenever total / checked / shares / extras
  // change. We only touch `baseText`, leaving the user's typing in other
  // columns alone, so this never loops back on itself.
  function recompute(): void {
    setRows((cur) => {
      if (totalMinor === null) {
        return cur.map((r) => ({ ...r, baseText: r.checked ? '' : r.baseText }));
      }
      let extrasSum = 0n;
      const extraMinors: bigint[] = cur.map((r) => {
        const v = parseSignedMajorMinor(r.extraText, currency);
        const e = v === null ? 0n : v;
        extrasSum += e;
        return e;
      });
      const remaining = totalMinor - extrasSum;
      if (remaining < 0n) {
        return cur.map((r) => ({ ...r, baseText: r.checked ? formatMinor(0n, currency) : '' }));
      }
      const weights = cur.map((r) => {
        if (!r.checked) return 0;
        const n = parseInt(r.shares || '0', 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      });
      void extraMinors;
      const distributed = distribute(remaining, weights);
      return cur.map((r, i) => ({
        ...r,
        baseText: r.checked ? formatMinor(distributed[i]!, currency) : '',
      }));
    });
  }

  // Auto-recompute trigger. We hash the inputs that should drive the base
  // column so React only re-runs when something material changed.
  const recomputeKey = useMemo(
    () =>
      JSON.stringify({
        c: currency,
        t: totalMinor?.toString() ?? null,
        rows: rows.map((r) => `${r.checked ? 1 : 0}|${r.shares}|${r.extraText}`),
      }),
    [currency, totalMinor, rows],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => recompute(), [recomputeKey]);

  // Toggle every row's checkbox in lockstep. If anyone is unchecked, click
  // selects all; otherwise it deselects all.
  function btnToggleAll() {
    const allChecked = rows.every((r) => r.checked);
    setRows((cur) =>
      cur.map((r) => {
        if (allChecked) return { ...r, checked: false, shares: '0' };
        const n = parseInt(r.shares || '0', 10);
        const shares = Number.isFinite(n) && n > 0 ? String(n) : '1';
        return { ...r, checked: true, shares };
      }),
    );
  }

  // Reset all currently-checked rows to a clean equal share (shares=1, extras
  // cleared). One-click "everybody splits the bill equally".
  function btnEqualSplitAll() {
    setRows((cur) => {
      const anyChecked = cur.some((r) => r.checked);
      if (!anyChecked) {
        return cur.map((r) => ({ ...r, checked: true, shares: '1', extraText: '' }));
      }
      return cur.map((r) =>
        r.checked ? { ...r, shares: '1', extraText: '' } : r,
      );
    });
  }

  // Bump a row's integer shares by ±1 (floor at 0). Sliders/dropdowns felt
  // heavy here — a tap-friendly stepper keeps the table compact.
  function bumpShares(memberId: string, delta: number) {
    setRows((cur) =>
      cur.map((r) => {
        if (r.memberId !== memberId) return r;
        const n = parseInt(r.shares || '0', 10);
        const next = Math.max(0, (Number.isFinite(n) ? n : 0) + delta);
        const nextStr = String(next);
        // Bumping from 0 implicitly checks the row; dropping to 0 unchecks.
        if (next === 0) return { ...r, checked: false, shares: '0' };
        return { ...r, checked: true, shares: nextStr };
      }),
    );
  }

  // Direct edit of the shares input. Mirrors `bumpShares`'s invariant that
  // 0 shares is meaningless — a row with no weight gets unchecked rather
  // than silently dragging the totals out of balance.
  function setShares(memberId: string, raw: string) {
    const digits = raw.replace(/\D/g, '');
    setRows((cur) =>
      cur.map((r) => {
        if (r.memberId !== memberId) return r;
        const n = digits === '' ? 0 : parseInt(digits, 10);
        if (!Number.isFinite(n) || n <= 0) {
          return { ...r, checked: false, shares: '0' };
        }
        return { ...r, checked: true, shares: String(n) };
      }),
    );
  }

  // Toggle a single row's checkbox. Keeps the "checked ↔ shares > 0"
  // invariant: checking a row whose current shares is '0' (e.g. legacy
  // EXACT split surfaced as extras) bumps it back up to 1 so it
  // immediately contributes to the base pool.
  function setChecked(memberId: string, checked: boolean) {
    setRows((cur) =>
      cur.map((r) => {
        if (r.memberId !== memberId) return r;
        if (!checked) return { ...r, checked: false, shares: '0' };
        const n = parseInt(r.shares || '0', 10);
        const shares = Number.isFinite(n) && n > 0 ? String(n) : '1';
        return { ...r, checked: true, shares };
      }),
    );
  }

  // ─── Live totals ─────────────────────────────────────────────────────
  // Final[i] = (checked ? base : 0) + extra. Extras count for everyone.
  const { sumMinor, perMemberFinal, anyParseError } = useMemo(() => {
    let s = 0n;
    let bad = false;
    const final: bigint[] = rows.map((r) => {
      const extraV = parseSignedMajorMinor(r.extraText, currency);
      if (extraV === null) {
        bad = true;
        return 0n;
      }
      let baseV: bigint;
      if (r.checked) {
        const parsed = parseMajorMinor(r.baseText, currency);
        if (parsed === null) {
          bad = true;
          return 0n;
        }
        baseV = parsed;
      } else {
        baseV = 0n;
      }
      const v = baseV + extraV;
      if (v < 0n) {
        bad = true;
        return 0n;
      }
      s += v;
      return v;
    });
    return { sumMinor: s, perMemberFinal: final, anyParseError: bad };
  }, [rows, currency]);

  const sumMatchesTotal = totalMinor !== null && !anyParseError && sumMinor === totalMinor;
  const diffMinor = totalMinor !== null ? totalMinor - sumMinor : 0n;

  // ─── Server expects splitRule JSON ──────────────────────────────────
  const ruleJson = useMemo(() => {
    const amounts = rows
      .map((r, i) => ({
        memberId: r.memberId,
        amountMinor: perMemberFinal[i]!.toString(),
      }))
      .filter((a) => BigInt(a.amountMinor) > 0n);
    const rule: SplitRule = { type: 'EXACT', amounts };
    return JSON.stringify(rule);
  }, [rows, perMemberFinal]);

  // Round-trip the raw editor state so the edit page can restore it without
  // reverse-engineering the EXACT amounts back into shares/extras.
  const splitInputStateJson = useMemo(() => {
    const state: SplitInputState = {
      rows: rows.map((r) => ({
        memberId: r.memberId,
        checked: r.checked,
        shares: r.shares,
        extraText: r.extraText,
      })),
    };
    return JSON.stringify(state);
  }, [rows]);

  // ─── Receipt staging ────────────────────────────────────────────────
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingReceipts, setUploadingReceipts] = useState(false);
  const [receiptAiPrompt, setReceiptAiPrompt] = useState<AiImageContext | null>(null);
  const [receiptAiPending, setReceiptAiPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigatedRef = useRef(false);

  async function fileToDataUrl(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('BAD_READER_RESULT'));
      };
      reader.onerror = () => reject(new Error('FILE_READ_FAILED'));
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(picked: FileList | null) {
    if (!picked) return;
    const next: File[] = [...pendingFiles];
    let firstImageForAi: File | null = null;
    for (const f of Array.from(picked)) {
      if (f.size > MAX_BYTES) {
        errorToast(t('expenses.file_too_large'));
        continue;
      }
      if (!ALLOWED.has(f.type)) {
        errorToast(t('expenses.unsupported_type'));
        continue;
      }
      if (!firstImageForAi && f.type.startsWith('image/')) firstImageForAi = f;
      next.push(f);
    }
    setPendingFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Ask once per pick-batch using the app modal. If accepted, we submit
    // directly to AI instead of merely attaching the image for later.
    if (firstImageForAi) {
      if (firstImageForAi.size > MAX_AI_IMAGE_BYTES) {
        errorToast(t('expenses.ai_image_too_large'));
      } else {
        try {
          const dataUrl = await fileToDataUrl(firstImageForAi);
          setReceiptAiPrompt({
            name: firstImageForAi.name,
            mime: firstImageForAi.type,
            dataUrl,
          });
        } catch {
          errorToast(t('errors.ai_failed'));
        }
      }
    }
  }

  function removeFile(idx: number) {
    setPendingFiles((cur) => cur.filter((_, i) => i !== idx));
  }

  // After the action succeeds, upload staged files and navigate.
  useEffect(() => {
    if (!state.ok || !state.expenseId || navigatedRef.current) return;
    navigatedRef.current = true;
    const expenseId = state.expenseId;
    const filesToUpload = pendingFiles;
    let cancelled = false;
    (async () => {
      if (filesToUpload.length > 0) {
        setUploadingReceipts(true);
        for (const file of filesToUpload) {
          if (cancelled) return;
          try {
            const signRes = await fetch(
              `/api/groups/${groupId}/expenses/${expenseId}/receipts/sign`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mime: file.type, size: file.size }),
              },
            );
            if (!signRes.ok) continue;
            const { url, key } = (await signRes.json()) as { url: string; key: string };
            const putRes = await fetch(url, {
              method: 'PUT',
              headers: { 'Content-Type': file.type },
              body: file,
            });
            if (!putRes.ok) continue;
            await fetch(`/api/groups/${groupId}/expenses/${expenseId}/receipts`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key, mime: file.type, size: file.size }),
            });
          } catch {
            // best effort
          }
        }
      }
      if (!cancelled) router.push(`/groups/${groupId}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [state.ok, state.expenseId, pendingFiles, groupId, router]);

  // Suppress unused-import warnings (used only conditionally).
  void minorToDecimal;
  void decimalToMinor;
  void minorUnits;

  const submitDisabled =
    pending ||
    uploadingReceipts ||
    (!isDraftMode && !sumMatchesTotal);

  // ─── AI-assisted parsing ───────────────────────────────
  // The user types a free-form sentence; we POST it to the parse endpoint
  // and apply the suggestion to the (mostly uncontrolled) form fields by
  // grabbing the form ref. The user always sees the result before saving.
  const formRef = useRef<HTMLFormElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiPending, setAiPending] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiAmbiguousHint, setAiAmbiguousHint] = useState<string | null>(null);
  const [aiImage, setAiImage] = useState<AiImageContext | null>(null);

  function setFieldValue(name: string, value: string) {
    const el = formRef.current?.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    if (!el) return;
    el.value = value;
  }

  async function runAiParse(opts?: {
    image?: AiImageContext;
    textOverride?: string;
    setLoading?: (loading: boolean) => void;
  }) {
    const image = opts?.image ?? aiImage;
    const text = (opts?.textOverride ?? aiText).trim();
    if (!text && !image) return;
    opts?.setLoading?.(true);
    setAiPending(true);
    setAiReasoning(null);
    setAiAmbiguousHint(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/expenses/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          images: image
            ? [
                {
                  name: image.name,
                  mime: image.mime,
                  dataUrl: image.dataUrl,
                },
              ]
            : [],
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const code = payload.error;
        if (payload.detail && payload.error !== 'IMAGE_UNSUPPORTED') {
          // Dev-friendly detail passthrough; fallback still shown below.
          errorToast(payload.detail);
        }
        showI18nError(
          t,
          code === 'NOT_CONFIGURED'
            ? 'errors.ai_not_configured'
            : code === 'IMAGE_UNSUPPORTED'
              ? 'errors.ai_image_unsupported'
            : code === 'RATE_LIMITED'
              ? 'errors.rate_limited'
              : code === 'TIMEOUT'
                ? 'errors.ai_timeout'
                : 'errors.ai_failed',
        );
        return;
      }
      const { suggestion } = (await res.json()) as {
        suggestion: {
          title: string | null;
          occurredAt: string | null;
          currency: string | null;
          amount: string | null;
          payerMemberId: string | null;
          note: string | null;
          reasoning: string | null;
          ambiguousHint: string | null;
        };
      };
      if (suggestion.title) setFieldValue('title', suggestion.title);
      if (suggestion.occurredAt) setFieldValue('occurredAt', suggestion.occurredAt);
      if (suggestion.currency) setCurrency(suggestion.currency);
      // Only auto-fill amount when not in draft mode (the input is hidden).
      if (!isDraftMode && suggestion.amount) setAmountText(suggestion.amount);
      if (
        suggestion.payerMemberId &&
        !lockedPayerMemberId &&
        members.some((m) => m.id === suggestion.payerMemberId)
      ) {
        setFieldValue('payerMemberId', suggestion.payerMemberId);
      }
      if (suggestion.note) setFieldValue('note', suggestion.note);
      setAiReasoning(suggestion.reasoning);
      setAiAmbiguousHint(suggestion.ambiguousHint);
    } catch {
      showI18nError(t, 'errors.ai_failed');
    } finally {
      setAiPending(false);
      opts?.setLoading?.(false);
    }
  }

  async function confirmReceiptAi() {
    if (!receiptAiPrompt) return;
    const prompt = aiText.trim() || t('expenses.ai_receipt_prompt_text');
    if (!aiText.trim()) setAiText(prompt);
    setAiOpen(true);
    await runAiParse({
      image: receiptAiPrompt,
      textOverride: prompt,
      setLoading: setReceiptAiPending,
    });
    setReceiptAiPrompt(null);
  }

  return (
    <form
      action={formAction}
      ref={formRef}
      className="flex w-full flex-col gap-5"
    >
      <input type="hidden" name="groupId" value={groupId} />
      {/* Only submit a splitRule when we actually have a materialized split.
          In DRAFT mode the row amounts are all zero, which would fail the
          EXACT-rule "min 1 amount" validation server-side. */}
      {!isDraftMode && (
        <>
          <input type="hidden" name="splitRule" value={ruleJson} />
          <input
            type="hidden"
            name="splitInputState"
            value={splitInputStateJson}
          />
        </>
      )}
      <input
        type="hidden"
        name="isDraft"
        value={isDraftMode ? 'true' : 'false'}
      />
      {defaults && <input type="hidden" name="expenseId" value={defaults.expenseId} />}

      <Dialog
        open={receiptAiPrompt !== null}
        onClose={() => {
          if (!receiptAiPending) setReceiptAiPrompt(null);
        }}
        title={t('expenses.ai_receipt_dialog_title')}
        className="max-w-sm"
      >
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('expenses.ai_receipt_dialog_desc')}
          </p>
          {receiptAiPrompt && (
            <div className="bg-secondary/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <Paperclip className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate">{receiptAiPrompt.name}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setReceiptAiPrompt(null)}
              disabled={receiptAiPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={confirmReceiptAi}
              disabled={receiptAiPending}
            >
              {receiptAiPending ? t('expenses.ai_running') : t('expenses.ai_run')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ─── Top tools: AI assist + draft mode ─────────────────────
          Keep both controls in the same row and same button style. The
          draft button is hidden when editing an already-materialized
          expense to avoid an accidental "demote-to-draft". */}
      <div className="-mb-1 flex flex-wrap items-center gap-2">
        {!defaults && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAiOpen((open) => !open)}
            className={aiOpen ? 'bg-secondary' : undefined}
          >
            <Sparkles className="size-4" /> {t('expenses.ai_open')}
          </Button>
        )}
        {!lockedNonDraft && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsDraftMode((v) => !v)}
            className={isDraftMode ? 'bg-secondary' : undefined}
            title={t('expenses.draft_mode_hint')}
          >
            {t('expenses.draft_mode_label')}
          </Button>
        )}
      </div>

      {/* ─── AI assist panel ───────────────────────────────────────
          A collapsible textarea that POSTs the user's description to
          the parse endpoint and applies the returned suggestion to the
          form fields. The user always reviews before saving. */}
      {!defaults && aiOpen && (
        <div className="flex flex-col gap-2">
            <div className="bg-secondary/30 flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-4" /> {t('expenses.ai_title')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => {
                    setAiOpen(false);
                    setAiText('');
                    setAiReasoning(null);
                    setAiAmbiguousHint(null);
                    setAiImage(null);
                  }}
                  aria-label={t('expenses.clear')}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              {aiImage && (
                <div className="bg-background/60 flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                  <span className="text-muted-foreground truncate">
                    {t('expenses.ai_image_in_context', { name: aiImage.name })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    onClick={() => setAiImage(null)}
                    aria-label={t('expenses.clear')}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              )}
              <Textarea
                rows={2}
                maxLength={1000}
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder={t('expenses.ai_placeholder')}
              />
              {aiAmbiguousHint && (
                <p className="bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 rounded-md px-2 py-1 text-xs">
                  {aiAmbiguousHint}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {aiReasoning ?? t('expenses.ai_hint')}
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => runAiParse()}
                  disabled={aiPending || (aiText.trim().length === 0 && !aiImage)}
                >
                  {aiPending ? t('expenses.ai_running') : t('expenses.ai_run')}
                </Button>
              </div>
            </div>
        </div>
      )}

      {/* ─── Row 1: Date | Title ──────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="occurredAt">{t('expenses.date')}</Label>
          <Input
            id="occurredAt"
            name="occurredAt"
            type="date"
            required
            defaultValue={
              defaults
                ? defaults.occurredAt.toISOString().slice(0, 10)
                : todayLocalISO()
            }
          />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="title">{t('expenses.title_field')}</Label>
          <Input
            id="title"
            name="title"
            required
            maxLength={120}
            defaultValue={defaults?.title ?? ''}
            placeholder={t('expenses.title_placeholder')}
          />
        </div>
      </div>

      {/* ─── Row 2: Amount | Currency | Payer | Attach receipts ────
          Mobile: amount + currency share one row, then payer + attach
          stack below. Desktop keeps the original four-column row. */}
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
        {!isDraftMode && (
          <div className="grid gap-2 sm:contents">
            <div className="grid grid-cols-[1fr_auto] gap-3 sm:contents">
              <div className="grid gap-2">
                <Label htmlFor="amount">{t('expenses.amount')}</Label>
                <NumericInput
                  id="amount"
                  name="amount"
                  required
                  placeholder="0.00"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  keypadTitle={t('expenses.amount')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="currency">{t('expenses.currency')}</Label>
                <Input
                  id="currency"
                  name="currency"
                  required
                  minLength={3}
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  className="w-20 uppercase"
                />
              </div>
            </div>
          </div>
        )}
        {isDraftMode && (
          <div className="grid gap-2">
            <Label htmlFor="currency">{t('expenses.currency')}</Label>
            <Input
              id="currency"
              name="currency"
              required
              minLength={3}
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className="w-20 uppercase"
            />
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-3 sm:contents">
          <div className="grid gap-2">
            <Label htmlFor="payerMemberId">{t('expenses.payer')}</Label>
            {lockedPayerMemberId ? (
              <>
                <input
                  type="hidden"
                  name="payerMemberId"
                  value={lockedPayerMemberId}
                />
                <p className="border-input bg-muted/50 text-muted-foreground flex h-10 items-center rounded-md border px-3 text-sm">
                  {members.find((m) => m.id === lockedPayerMemberId)?.displayName ?? '?'}
                </p>
              </>
            ) : (
              <Select
                id="payerMemberId"
                name="payerMemberId"
                required
                defaultValue={defaults?.payerMemberId ?? members[0]?.id}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="flex items-end">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
              <span className="hidden sm:inline">{t('expenses.attach_receipts')}</span>
            </Button>
          </div>
        </div>
      </div>

      {!isDraftMode && currency !== groupCurrency && (
        <div className="grid gap-2">
          <Label htmlFor="fxRateOverride">{t('expenses.fx_rate_override')}</Label>
          <NumericInput
            id="fxRateOverride"
            name="fxRateOverride"
            placeholder={t('expenses.fx_rate_hint', { from: currency, to: groupCurrency })}
            defaultValue={defaults?.fxRateOverride ?? ''}
            precision={6}
            keypadTitle={t('expenses.fx_rate_override')}
          />
        </div>
      )}

      {(pendingFiles.length > 0) && (
        <div className="flex flex-col gap-1">
          {pendingFiles.length > 0 && (
            <ul className="flex flex-col gap-1">
              {pendingFiles.map((f, i) => (
                <li
                  key={i}
                  className="bg-muted/40 flex items-center justify-between gap-2 rounded px-3 py-1.5 text-sm"
                >
                  <span className="truncate">
                    <Paperclip className="mr-1 inline size-3" />
                    {f.name}
                    <span className="text-muted-foreground ml-2 text-xs">
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => removeFile(i)}
                    aria-label={t('expenses.remove_receipt')}
                  >
                    <X className="size-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── Split rule (hidden in DRAFT mode) ──────────────── */}
      {!isDraftMode && (
      <fieldset className="grid gap-3 rounded-md border p-3 sm:p-4">
        <legend className="px-2 text-sm font-medium">{t('expenses.split_rule')}</legend>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={btnToggleAll}>
            {rows.every((r) => r.checked)
              ? t('expenses.btn_deselect_all')
              : t('expenses.btn_select_all')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={btnEqualSplitAll}>
            {t('expenses.btn_equal_split_all')}
          </Button>
        </div>

        {/* ─── Desktop: tabular layout ───────────────────────── */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="w-7 px-1 py-1 text-left"></th>
                <th className="px-2 py-1 text-left font-medium">
                  {t('expenses.col_member')}
                </th>
                <th className="w-32 px-1 py-1 text-center font-medium">
                  {t('expenses.col_shares')}
                </th>
                <th className="w-24 px-1 py-1 text-right font-medium">
                  {t('expenses.col_base')}
                </th>
                <th className="w-28 px-1 py-1 text-right font-medium">
                  {t('expenses.col_extra')}
                </th>
                <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                  {t('expenses.col_subtotal')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const m = members.find((x) => x.id === r.memberId);
                if (!m) return null;
                const hasContribution = r.checked || perMemberFinal[i]! > 0n;
                const baseShown = r.checked ? r.baseText || formatMinor(0n, currency) : null;
                return (
                  <tr key={r.memberId} className="border-t">
                    <td className="px-1 py-1.5">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={r.checked}
                        onChange={(e) => setChecked(r.memberId, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-medium">{m.displayName}</td>
                    <td className="px-1 py-1.5">
                      <SharesStepper
                        value={r.shares}
                        disabled={!r.checked}
                        onChange={(v) => setShares(r.memberId, v)}
                        onBump={(d) => bumpShares(r.memberId, d)}
                        decLabel={t('expenses.shares_dec')}
                        incLabel={t('expenses.shares_inc')}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {baseShown ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-1 py-1.5">
                      <ExtraInput
                        value={r.extraText}
                        onChange={(v) => updateRow(r.memberId, { extraText: v })}
                        clearLabel={t('expenses.clear')}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {hasContribution ? (
                        <>
                          <span className="text-muted-foreground mr-1 text-xs">
                            {currency}
                          </span>
                          {formatMinor(perMemberFinal[i]!, currency)}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td colSpan={4} className="px-2 py-2 text-right text-xs">
                  {t('expenses.split_total')}
                </td>
                <td className="px-1 py-2 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                  {totalMinor !== null ? (
                    <>
                      <span className="text-muted-foreground mr-1">{currency}</span>
                      {formatMinor(totalMinor, currency)}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td
                  className={`px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap ${
                    sumMatchesTotal
                      ? 'text-emerald-600'
                      : totalMinor === null
                        ? 'text-muted-foreground'
                        : 'text-destructive'
                  }`}
                >
                  <span className="text-muted-foreground mr-1 text-xs">{currency}</span>
                  {formatMinor(sumMinor, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ─── Mobile: stacked card layout ────────────────────
            Tapping the row toggles the checkbox; stepper sits in the same
            row so adjustments need only one thumb. */}
        <ul className="flex flex-col gap-2 md:hidden">
          {rows.map((r, i) => {
            const m = members.find((x) => x.id === r.memberId);
            if (!m) return null;
            const finalMinor = perMemberFinal[i]!;
            const hasContribution = r.checked || finalMinor > 0n;
            return (
              <li
                key={r.memberId}
                className={`flex flex-col gap-2 rounded-md border p-2.5 ${
                  r.checked ? 'bg-card' : 'bg-muted/30'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={r.checked}
                    onChange={(e) => setChecked(r.memberId, e.target.checked)}
                    aria-label={m.displayName}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {m.displayName}
                  </span>
                  <span className="text-right font-mono text-sm tabular-nums whitespace-nowrap">
                    {hasContribution ? (
                      <>
                        <span className="text-muted-foreground mr-1 text-xs">
                          {currency}
                        </span>
                        {formatMinor(finalMinor, currency)}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                      {t('expenses.col_shares')}
                    </span>
                    <SharesStepper
                      value={r.shares}
                      disabled={!r.checked}
                      onChange={(v) => setShares(r.memberId, v)}
                      onBump={(d) => bumpShares(r.memberId, d)}
                      decLabel={t('expenses.shares_dec')}
                      incLabel={t('expenses.shares_inc')}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                      {t('expenses.col_extra')}
                    </span>
                    <ExtraInput
                      value={r.extraText}
                      onChange={(v) => updateRow(r.memberId, { extraText: v })}
                      clearLabel={t('expenses.clear')}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* ─── Totals readout (mobile only — desktop has it in tfoot) ─ */}
        <div className="flex items-center justify-between gap-3 text-sm md:hidden">
          <span className="text-muted-foreground text-xs">
            {t('expenses.split_total')}
          </span>
          <span className="flex items-baseline gap-3 font-mono tabular-nums">
            <span className="text-muted-foreground text-xs">
              {totalMinor !== null
                ? formatMinor(totalMinor, currency)
                : '—'}
            </span>
            <span
              className={
                sumMatchesTotal
                  ? 'text-emerald-600'
                  : totalMinor === null
                    ? 'text-muted-foreground'
                    : 'text-destructive'
              }
            >
              {formatMinor(sumMinor, currency)} {currency}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {totalMinor !== null && !sumMatchesTotal && !anyParseError && (
            <p className="text-destructive text-xs">
              {t('expenses.split_diff', {
                diff: `${diffMinor < 0n ? '+' : ''}${formatMinor(-diffMinor, currency)}`,
                currency,
              })}
            </p>
          )}
          {anyParseError && (
            <p className="text-destructive text-xs">{t('errors.invalid_amount')}</p>
          )}
        </div>
      </fieldset>
      )}

      {/* ─── Note ─────────────────────────────────────────────────── */}
      <div className="grid gap-2">
        <Label htmlFor="note">{t('expenses.note')}</Label>
        <Textarea
          id="note"
          name="note"
          rows={2}
          maxLength={2000}
          defaultValue={defaults?.note ?? ''}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={submitDisabled}
          {...(isDraftMode ? { formNoValidate: true } : {})}
        >
          {uploadingReceipts
            ? t('expenses.uploading_receipts')
            : pending
              ? t('expenses.submitting')
              : isDraftMode
                ? t('expenses.submit_draft')
                : t('expenses.submit')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Tap-friendly integer share stepper. The middle input stays editable so
 * power users can still type, but most adjustments are one tap on ±.
 */
function SharesStepper({
  value,
  disabled,
  onChange,
  onBump,
  decLabel,
  incLabel,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onBump: (delta: number) => void;
  decLabel: string;
  incLabel: string;
}) {
  const n = parseInt(value || '0', 10);
  const canDec = !disabled && Number.isFinite(n) && n > 0;
  return (
    <div className="border-input bg-background inline-flex h-9 w-full max-w-[120px] items-stretch overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => onBump(-1)}
        disabled={!canDec}
        aria-label={decLabel}
        className="hover:bg-accent text-muted-foreground disabled:text-muted-foreground/40 grid w-9 place-items-center disabled:cursor-not-allowed"
      >
        <Minus className="size-4" />
      </button>
      <NumericInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        mode="integer"
        disabled={disabled}
        unstyled
        className="w-full min-w-0 flex-1 border-x bg-transparent text-center text-sm tabular-nums focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => onBump(1)}
        aria-label={incLabel}
        className="hover:bg-accent text-muted-foreground grid w-9 place-items-center"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Decimal input that clears with an inline X when it has content. */
function ExtraInput({
  value,
  onChange,
  clearLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  clearLabel: string;
}) {
  return (
    <div className="relative">
      <NumericInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        allowNegative
        className="h-9 w-full pr-7 pl-2 text-right tabular-nums font-mono"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 grid -translate-y-1/2 place-items-center rounded p-0.5"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
