import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import Decimal from 'decimal.js';
import { Minus, Paperclip, Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CurrencySelect } from '@/components/money/currency-select';
import {
  createExpenseAction,
  updateExpenseAction,
  type ExpenseActionState,
} from '@/spa/actions/expenses';
import { errorToast, showI18nError, successToast } from '@/lib/ui/toast';
import { describeSplitIntent } from '@/lib/split/intent';
import type { SplitRule } from '@/lib/split/types';
import type { SplitInputState, SplitInputRow } from '@/lib/split/input-state';
import { computeSplit } from '@/lib/split';
import {
  decimalToMinor,
  formatMinor,
  isCurrencyCode,
  minorToDecimal,
  minorUnits,
  parseAmountToMinor,
} from '@/lib/money';
import { mergeAiRows, type CurrentSnapshot } from '@/lib/expenses/ai-schema';
import { useAiParseStream } from '@/lib/expenses/use-ai-parse-stream';

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
    version?: number;
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
  const ranked = rows.slice().sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);
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
  const [amountText, setAmountText] = useState(defaults?.amountText ?? ''); // DRAFT mode: hides the amount / fx / split UI entirely. The action layer
  // sees `isDraft=true` and persists the row without an amount, leaving the
  // payer to fill it in later via the group page's quick-fill panel.
  //
  // For an existing materialized expense we never offer the toggle (would
  // amount to a destructive "demote"); for a new entry, default OFF.
  const lockedNonDraft = !!defaults && defaults.isDraft === false;
  const [isDraftMode, setIsDraftMode] = useState<boolean>(
    lockedNonDraft ? false : (defaults?.isDraft ?? false),
  );
  const currencyPrecision = minorUnits(currency);
  const amountPlaceholder = formatMinor(0n, currency);
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
  const [splitEditorOpen, setSplitEditorOpen] = useState(false);

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
      return cur.map((r) => (r.checked ? { ...r, shares: '1', extraText: '' } : r));
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
  const splitIntent = describeSplitIntent(rows);
  const participantIdSet = new Set(splitIntent.participantIds);
  const activeSplitRows = rows.flatMap((row, index) =>
    participantIdSet.has(row.memberId) ? [{ row, finalMinor: perMemberFinal[index]! }] : [],
  );
  const activeSplitCount = activeSplitRows.length;
  const equalShareMinor = activeSplitRows[0]?.finalMinor ?? 0n;
  const equalAmountsMatch = activeSplitRows.every(
    ({ finalMinor }) => finalMinor === equalShareMinor,
  );
  const soloMemberName =
    members.find((member) => member.id === splitIntent.participantIds[0])?.displayName ?? '?';
  const splitSummaryTitle =
    splitIntent.kind === 'SOLO'
      ? t('expenses.split_summary_solo', { name: soloMemberName })
      : splitIntent.kind === 'EQUAL'
        ? t('expenses.split_summary_equal', { count: activeSplitCount })
        : splitIntent.kind === 'RATIO'
          ? t('expenses.split_summary_ratio', { count: activeSplitCount })
          : t('expenses.split_summary_custom', { count: activeSplitCount });
  const splitSummaryDetail =
    splitIntent.kind === 'SOLO'
      ? `${formatMinor(equalShareMinor, currency)} ${currency}`
      : splitIntent.kind === 'EQUAL' && totalMinor !== null && equalAmountsMatch
        ? `${t('expenses.share_per_person')} ${formatMinor(equalShareMinor, currency)} ${currency}`
        : splitIntent.kind === 'EQUAL' && totalMinor !== null
          ? t('expenses.split_summary_equal_rounded')
          : splitIntent.kind === 'EQUAL' || splitIntent.kind === 'RATIO'
            ? t('expenses.split_summary_ratio_detail', { ratio: splitIntent.ratio.join(':') })
            : t('expenses.split_summary_custom_detail');

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
  const pendingFilesRef = useRef<File[]>([]);
  const receiptControlsLocked = pending || uploadingReceipts || state.ok;

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
    if (!picked || receiptControlsLocked) return;
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
    pendingFilesRef.current = next;
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
    if (receiptControlsLocked) return;
    setPendingFiles((cur) => {
      const next = cur.filter((_, i) => i !== idx);
      pendingFilesRef.current = next;
      return next;
    });
  }

  // After the action succeeds, upload staged files and navigate.
  useEffect(() => {
    if (!state.ok || !state.expenseId || navigatedRef.current) return;
    navigatedRef.current = true;
    const expenseId = state.expenseId;
    const filesToUpload = [...pendingFilesRef.current];
    let cancelled = false;
    (async () => {
      let failedUploads = 0;
      if (filesToUpload.length > 0) {
        setUploadingReceipts(true);
        for (const file of filesToUpload) {
          if (cancelled) return;
          try {
            const uploadRes = await fetch(`/api/groups/${groupId}/expenses/${expenseId}/receipts`, {
              method: 'POST',
              headers: { 'Content-Type': file.type },
              body: file,
            });
            if (!uploadRes.ok) failedUploads += 1;
          } catch {
            failedUploads += 1;
          }
        }
      }
      if (!cancelled) {
        if (failedUploads > 0) errorToast(t('expenses.upload_failed'));
        router.push(`/groups/${groupId}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.ok, state.expenseId, groupId, router, t]);

  // Suppress unused-import warnings (used only conditionally).
  void minorToDecimal;
  void decimalToMinor;
  void minorUnits;

  const submitDisabled = pending || uploadingReceipts || (!isDraftMode && !sumMatchesTotal);

  // ─── AI-assisted parsing ───────────────────────────────
  // The user types a free-form sentence; we POST it to the streaming parse
  // endpoint and apply each field as it arrives. The user always sees the
  // result before saving — AI never auto-submits.
  const formRef = useRef<HTMLFormElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
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
    flashElement(el);
  }

  function flashElement(el: HTMLElement) {
    el.classList.remove('ai-flash');
    void el.offsetWidth;
    el.classList.add('ai-flash');
    setTimeout(() => el.classList.remove('ai-flash'), 700);
  }

  // Snapshot the current form state for edit-mode AI calls so the model
  // sees the values it's being asked to adjust.
  function buildCurrentSnapshot(): CurrentSnapshot | undefined {
    if (!defaults) return undefined;
    const titleEl = formRef.current?.elements.namedItem('title') as HTMLInputElement | null;
    const dateEl = formRef.current?.elements.namedItem('occurredAt') as HTMLInputElement | null;
    const payerEl = formRef.current?.elements.namedItem('payerMemberId') as
      | HTMLSelectElement
      | HTMLInputElement
      | null;
    const noteEl = formRef.current?.elements.namedItem('note') as HTMLTextAreaElement | null;
    const fxEl = formRef.current?.elements.namedItem('fxRateOverride') as HTMLInputElement | null;
    return {
      title: titleEl?.value || null,
      occurredAt: dateEl?.value || null,
      currency,
      amount: isDraftMode ? null : amountText || null,
      payerMemberId: lockedPayerMemberId ?? payerEl?.value ?? null,
      note: noteEl?.value || null,
      isDraft: isDraftMode,
      fxRateOverride: fxEl?.value || null,
      splitRows: isDraftMode
        ? undefined
        : rows.map((r) => ({
            memberId: r.memberId,
            checked: r.checked,
            shares: r.shares,
            extraText: r.extraText,
          })),
    };
  }

  const aiStream = useAiParseStream({
    groupId,
    onField: (name, value) => {
      switch (name) {
        case 'title':
          if (typeof value === 'string') setFieldValue('title', value);
          return;
        case 'occurredAt':
          if (typeof value === 'string') setFieldValue('occurredAt', value);
          return;
        case 'currency':
          if (typeof value === 'string') {
            const nextCurrency = value.trim().toUpperCase();
            if (isCurrencyCode(nextCurrency)) setCurrency(nextCurrency);
          }
          return;
        case 'amount':
          if (typeof value === 'string' && !isDraftMode) {
            setAmountText(value);
          }
          return;
        case 'payerMemberId':
          if (
            typeof value === 'string' &&
            !lockedPayerMemberId &&
            members.some((m) => m.id === value)
          ) {
            setFieldValue('payerMemberId', value);
          }
          return;
        case 'note':
          if (typeof value === 'string') setFieldValue('note', value);
          return;
        case 'isDraft':
          if (typeof value === 'boolean' && !lockedNonDraft) {
            setIsDraftMode(value);
          }
          return;
        case 'fxRateOverride':
          if (typeof value === 'string') {
            setFieldValue('fxRateOverride', value);
          }
          return;
        case 'reasoning':
          if (typeof value === 'string') setAiReasoning(value);
          return;
        case 'ambiguousHint':
          if (typeof value === 'string') setAiAmbiguousHint(value);
          return;
        case 'tags':
          // Tags are not surfaced in the UI yet; ignore.
          return;
      }
    },
    onSplit: (_mode, aiRows: SplitInputRow[]) => {
      if (isDraftMode) return;
      setRows((cur) => mergeAiRows(cur, aiRows));
      successToast(t('expenses.ai_split_updated'));
    },
    onMeta: ({ payerName, participants }) => {
      if (payerName) {
        successToast(t('expenses.ai_unresolved_payer', { name: payerName }));
      }
      if (participants && participants.length > 0) {
        successToast(
          t('expenses.ai_unresolved_participants', {
            names: participants.join(', '),
          }),
        );
      }
    },
    onError: (code, detail) => {
      if (detail && code !== 'IMAGE_UNSUPPORTED') errorToast(detail);
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
                : code === 'STREAM_INTERRUPTED'
                  ? 'expenses.ai_stream_interrupted'
                  : 'errors.ai_failed',
      );
    },
  });

  const aiPending = aiStream.pending;

  async function runAiParse(opts?: {
    image?: AiImageContext;
    textOverride?: string;
    setLoading?: (loading: boolean) => void;
  }) {
    const image = opts?.image ?? aiImage;
    const text = (opts?.textOverride ?? aiText).trim();
    if (!text && !image) return;
    setAiReasoning(null);
    setAiAmbiguousHint(null);
    opts?.setLoading?.(true);
    try {
      await aiStream.start({
        text,
        images: image
          ? [{ name: image.name, mime: image.mime, dataUrl: image.dataUrl }]
          : undefined,
        current: buildCurrentSnapshot(),
      });
    } finally {
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
      className="bg-card relative flex w-full flex-col overflow-hidden rounded-xl border pb-24 lg:pb-0"
    >
      <input type="hidden" name="groupId" value={groupId} />
      {/* Only submit a splitRule when we actually have a materialized split.
          In DRAFT mode the row amounts are all zero, which would fail the
          EXACT-rule "min 1 amount" validation server-side. */}
      {!isDraftMode && (
        <>
          <input type="hidden" name="splitRule" value={ruleJson} />
          <input type="hidden" name="splitInputState" value={splitInputStateJson} />
        </>
      )}
      <input type="hidden" name="isDraft" value={isDraftMode ? 'true' : 'false'} />
      {defaults && <input type="hidden" name="expenseId" value={defaults.expenseId} />}
      {defaults && <input type="hidden" name="expectedVersion" value={defaults.version ?? 0} />}

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
            <Button type="button" onClick={confirmReceiptAi} disabled={receiptAiPending}>
              {receiptAiPending ? t('expenses.ai_running') : t('expenses.ai_run')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ─── Top tools: AI assist + draft mode ─────────────────────
          Keep both controls in the same row and same button style. The
          draft button is hidden when editing an already-materialized
          expense to avoid an accidental "demote-to-draft". */}
      <div className="flex flex-wrap items-center gap-2 px-5 pt-5 sm:px-8 sm:pt-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAiOpen((open) => !open)}
          aria-expanded={aiOpen}
          className={aiOpen ? 'bg-secondary' : undefined}
        >
          <Sparkles className="size-4" /> {t('expenses.ai_open')}
        </Button>
        {!lockedNonDraft && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsDraftMode((v) => !v)}
            aria-pressed={isDraftMode}
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
      {aiOpen && (
        <div className="flex flex-col gap-2 px-5 pt-3 sm:px-8">
          <div className="bg-secondary/55 flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-4" />{' '}
                {defaults ? t('expenses.ai_describe_edit_title') : t('expenses.ai_title')}
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
              placeholder={
                defaults ? t('expenses.ai_placeholder_edit') : t('expenses.ai_placeholder')
              }
            />
            {aiAmbiguousHint && (
              <p className="bg-signal/20 text-signal-foreground dark:text-signal rounded-lg px-2.5 py-1.5 text-xs">
                {aiAmbiguousHint}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                {aiReasoning ?? t('expenses.ai_hint')}
              </p>
              <div className="flex items-center gap-2">
                {aiPending && (
                  <Button type="button" size="sm" variant="outline" onClick={() => aiStream.stop()}>
                    {t('expenses.ai_stop')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => runAiParse()}
                  disabled={aiPending || (aiText.trim().length === 0 && !aiImage)}
                >
                  {aiPending ? t('expenses.ai_streaming') : t('expenses.ai_run')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Row 2: Amount | Currency | Payer | Attach receipts ────
          Mobile: amount + currency share one row, then payer + attach
          stack below. Desktop keeps the original four-column row. */}
      <section className="bg-secondary/48 mt-5 flex flex-col gap-4 border-y px-5 py-6 sm:mt-6 sm:grid sm:grid-cols-[1.35fr_auto_1fr_auto] sm:items-end sm:px-8 sm:py-7">
        {!isDraftMode && (
          <div className="grid gap-2 sm:contents">
            <div className="grid grid-cols-[1fr_auto] gap-3 sm:contents">
              <div className="grid gap-2">
                <Label htmlFor="amount">{t('expenses.amount')}</Label>
                <NumericInput
                  id="amount"
                  name="amount"
                  required
                  placeholder={amountPlaceholder}
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  precision={currencyPrecision}
                  keypadTitle={t('expenses.amount')}
                  className="h-14 rounded-none border-0 bg-transparent px-0 font-mono text-3xl font-semibold tracking-[-0.045em] shadow-none ring-0 focus-visible:ring-0 sm:h-15 sm:text-4xl"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="currency">{t('expenses.currency')}</Label>
                <CurrencySelect
                  id="currency"
                  name="currency"
                  value={currency}
                  preferredCurrency={groupCurrency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="w-36 font-mono sm:w-40"
                />
              </div>
            </div>
          </div>
        )}
        {isDraftMode && (
          <div className="grid gap-2">
            <Label htmlFor="currency">{t('expenses.currency')}</Label>
            <CurrencySelect
              id="currency"
              name="currency"
              value={currency}
              preferredCurrency={groupCurrency}
              onChange={(event) => setCurrency(event.target.value)}
              className="w-40 font-mono"
            />
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-3 sm:contents">
          <div className="grid gap-2">
            <Label htmlFor="payerMemberId">{t('expenses.payer')}</Label>
            {lockedPayerMemberId ? (
              <>
                <input type="hidden" name="payerMemberId" value={lockedPayerMemberId} />
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
              disabled={receiptControlsLocked}
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={receiptControlsLocked}
              aria-label={t('expenses.attach_receipts')}
            >
              <Paperclip />
              <span className="hidden sm:inline">{t('expenses.attach_receipts')}</span>
            </Button>
          </div>
        </div>
      </section>

      {/* ─── Identity: title first, then date ─────────────────────── */}
      <section className="grid gap-4 px-5 py-6 sm:grid-cols-3 sm:px-8 sm:py-8">
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
        <div className="grid gap-2">
          <Label htmlFor="occurredAt">{t('expenses.date')}</Label>
          <Input
            id="occurredAt"
            name="occurredAt"
            type="date"
            required
            defaultValue={
              defaults ? defaults.occurredAt.toISOString().slice(0, 10) : todayLocalISO()
            }
          />
        </div>
      </section>

      {!isDraftMode && currency !== groupCurrency && (
        <div className="mx-5 grid gap-2 sm:mx-8">
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

      {pendingFiles.length > 0 && (
        <div className="mx-5 flex flex-col gap-1 sm:mx-8">
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
                    disabled={receiptControlsLocked}
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
        <fieldset className="bg-background/65 mx-5 mb-6 grid gap-4 rounded-lg border p-4 sm:mx-8 sm:p-5">
          <legend className="px-2 text-sm font-semibold">{t('expenses.split_rule')}</legend>

          <details
            className="group"
            open={splitEditorOpen}
            onToggle={(event) => setSplitEditorOpen(event.currentTarget.open)}
          >
            <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center gap-3 rounded-md p-1 focus-visible:ring-2 focus-visible:outline-hidden [&::-webkit-details-marker]:hidden">
              <span className="flex shrink-0 -space-x-1.5">
                {activeSplitRows.slice(0, 4).map(({ row }) => {
                  const member = members.find((candidate) => candidate.id === row.memberId);
                  return (
                    <span
                      key={row.memberId}
                      className="bg-secondary text-secondary-foreground ring-background grid size-7 place-items-center rounded-full font-mono text-[10px] font-bold ring-2"
                      aria-hidden
                    >
                      {member?.displayName.trim().slice(0, 1).toUpperCase() || '?'}
                    </span>
                  );
                })}
                {activeSplitRows.length > 4 ? (
                  <span
                    className="bg-muted text-muted-foreground ring-background grid size-7 place-items-center rounded-full font-mono text-[9px] font-bold ring-2"
                    aria-hidden
                  >
                    +{activeSplitRows.length - 4}
                  </span>
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm">{splitSummaryTitle}</strong>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {splitSummaryDetail}
                </span>
              </span>
              <span className="text-primary-ink text-xs font-semibold group-open:hidden">
                {t('expenses.adjust_split')}
              </span>
              <span className="text-muted-foreground hidden text-xs font-semibold group-open:inline">
                {t('expenses.collapse_split')}
              </span>
            </summary>

            <div className="mt-4 flex flex-col gap-4 border-t pt-4">
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
                  <thead className="text-muted-foreground font-mono text-[10px] tracking-[0.04em] uppercase">
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
                              aria-label={t('expenses.member_field', {
                                name: m.displayName,
                                field: t('expenses.split_rule'),
                              })}
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
                              label={t('expenses.member_field', {
                                name: m.displayName,
                                field: t('expenses.col_shares'),
                              })}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                            {baseShown ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-1 py-1.5">
                            <ExtraInput
                              value={r.extraText}
                              onChange={(v) => updateRow(r.memberId, { extraText: v })}
                              precision={currencyPrecision}
                              clearLabel={t('expenses.clear')}
                              label={t('expenses.member_field', {
                                name: m.displayName,
                                field: t('expenses.col_extra'),
                              })}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap tabular-nums">
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
                      <td className="px-1 py-2 text-right font-mono text-xs whitespace-nowrap tabular-nums">
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
                        className={`px-2 py-2 text-right font-mono whitespace-nowrap tabular-nums ${
                          sumMatchesTotal
                            ? 'text-positive-ink'
                            : totalMinor === null
                              ? 'text-muted-foreground'
                              : 'text-destructive-ink'
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
                        <span className="text-right font-mono text-sm whitespace-nowrap tabular-nums">
                          {hasContribution ? (
                            <>
                              <span className="text-muted-foreground mr-1 text-xs">{currency}</span>
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
                            label={t('expenses.member_field', {
                              name: m.displayName,
                              field: t('expenses.col_shares'),
                            })}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                            {t('expenses.col_extra')}
                          </span>
                          <ExtraInput
                            value={r.extraText}
                            onChange={(v) => updateRow(r.memberId, { extraText: v })}
                            precision={currencyPrecision}
                            clearLabel={t('expenses.clear')}
                            label={t('expenses.member_field', {
                              name: m.displayName,
                              field: t('expenses.col_extra'),
                            })}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* ─── Totals readout (mobile only — desktop has it in tfoot) ─ */}
              <div className="flex items-center justify-between gap-3 text-sm md:hidden">
                <span className="text-muted-foreground text-xs">{t('expenses.split_total')}</span>
                <span className="flex items-baseline gap-3 font-mono tabular-nums">
                  <span className="text-muted-foreground text-xs">
                    {totalMinor !== null ? formatMinor(totalMinor, currency) : '—'}
                  </span>
                  <span
                    className={
                      sumMatchesTotal
                        ? 'text-positive-ink'
                        : totalMinor === null
                          ? 'text-muted-foreground'
                          : 'text-destructive-ink'
                    }
                  >
                    {formatMinor(sumMinor, currency)} {currency}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                {totalMinor !== null && !sumMatchesTotal && !anyParseError && (
                  <p className="text-destructive-ink text-xs">
                    {t('expenses.split_diff', {
                      diff: `${diffMinor < 0n ? '+' : ''}${formatMinor(-diffMinor, currency)}`,
                      currency,
                    })}
                  </p>
                )}
                {anyParseError && (
                  <p className="text-destructive-ink text-xs">{t('errors.invalid_amount')}</p>
                )}
              </div>
            </div>
          </details>
        </fieldset>
      )}

      {/* ─── Note ─────────────────────────────────────────────────── */}
      <div className="mx-5 mb-5 grid gap-2 sm:mx-8 sm:mb-7">
        <Label htmlFor="note">{t('expenses.note')}</Label>
        <Textarea
          id="note"
          name="note"
          rows={2}
          maxLength={2000}
          defaultValue={defaults?.note ?? ''}
        />
      </div>

      <div className="bg-card/94 pb-safe-3 fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-3 backdrop-blur-lg lg:sticky lg:inset-x-auto lg:z-10 lg:px-8 lg:py-4">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-end">
          <Button
            type="submit"
            disabled={submitDisabled}
            size="lg"
            className="w-full sm:ml-auto sm:w-auto sm:min-w-40"
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
  label,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onBump: (delta: number) => void;
  decLabel: string;
  incLabel: string;
  label: string;
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
        keypadTitle={label}
        aria-label={label}
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
  precision,
  clearLabel,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  precision: number;
  clearLabel: string;
  label: string;
}) {
  return (
    <div className="relative">
      <NumericInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        allowNegative
        precision={precision}
        keypadTitle={label}
        aria-label={label}
        className="h-9 w-full pr-7 pl-2 text-right font-mono tabular-nums"
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
