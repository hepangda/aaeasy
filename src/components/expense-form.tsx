'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Decimal from 'decimal.js';
import { Paperclip, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import { computeSplit } from '@/lib/split';
import type { SplitRule } from '@/lib/split/types';
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
  /** Extra amount that goes 100% to this member, in MAJOR units. */
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
 * Build the initial SplitRow[] from either an EXACT rule or by running
 * `computeSplit` on a legacy rule (EQUAL/SUBSET/WEIGHTED). Either way the
 * result is "amounts as base, extras = 0".
 */
function rowsFromRule(
  rule: SplitRule | null,
  members: Member[],
  totalMinor: bigint,
  currency: string,
): SplitRow[] {
  // Default: everyone checked, equal split.
  let amountByMember = new Map<string, bigint>();
  if (rule && totalMinor > 0n) {
    try {
      amountByMember = computeSplit({
        totalMinor,
        rule,
        validMemberIds: new Set(members.map((m) => m.id)),
      });
    } catch {
      amountByMember = new Map();
    }
  }
  const checkedByDefault = !rule;
  return members.map((m) => {
    const amt = amountByMember.get(m.id) ?? 0n;
    const inUse = rule ? amt > 0n : checkedByDefault;
    return {
      memberId: m.id,
      checked: inUse,
      shares: inUse ? '1' : '0',
      baseText: amt > 0n ? formatMinor(amt, currency) : '',
      extraText: '',
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
    rowsFromRule(
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

  // 'EQUAL' = base shared equally across checked members; ignore the shares
  // column. 'RATIO' = base shared by the user-supplied integer share counts.
  // In both modes, the `extra` column contributes to a member's final amount
  // *regardless* of whether their checkbox is on (extras are direct charges).
  // The `base` column is always derived from the inputs above — the user
  // never types in it directly.
  type Mode = 'EQUAL' | 'RATIO';
  const [mode, setMode] = useState<Mode>('EQUAL');

  // Recompute the `base` column whenever total / mode / checked / shares /
  // extras change. We only touch `baseText`, leaving the user's typing in
  // other columns alone, so this never loops back on itself.
  function recompute(): void {
    setRows((cur) => {
      if (totalMinor === null) {
        return cur.map((r) => ({ ...r, baseText: r.checked ? '' : r.baseText }));
      }
      let extrasSum = 0n;
      const extraMinors: bigint[] = cur.map((r) => {
        const v = parseMajorMinor(r.extraText, currency);
        const e = v === null || v < 0n ? 0n : v;
        extrasSum += e;
        return e;
      });
      const remaining = totalMinor - extrasSum;
      if (remaining < 0n) {
        return cur.map((r) => ({ ...r, baseText: r.checked ? formatMinor(0n, currency) : '' }));
      }
      const weights = cur.map((r) => {
        if (!r.checked) return 0;
        if (mode === 'EQUAL') return 1;
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
        m: mode,
        c: currency,
        t: totalMinor?.toString() ?? null,
        rows: rows.map((r) => `${r.checked ? 1 : 0}|${r.shares}|${r.extraText}`),
      }),
    [mode, currency, totalMinor, rows],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => recompute(), [recomputeKey]);

  // Toggle every row's checkbox in lockstep. If anyone is unchecked, click
  // selects all; otherwise it deselects all.
  function btnToggleAll() {
    const allChecked = rows.every((r) => r.checked);
    setRows((cur) =>
      cur.map((r) => ({
        ...r,
        checked: !allChecked,
        shares: !allChecked ? r.shares || '1' : '0',
      })),
    );
  }

  // ─── Live totals ─────────────────────────────────────────────────────
  // Final[i] = (checked ? base : 0) + extra. Extras count for everyone.
  const { sumMinor, perMemberFinal, anyParseError } = useMemo(() => {
    let s = 0n;
    let bad = false;
    const final: bigint[] = rows.map((r) => {
      const extraV = parseMajorMinor(r.extraText, currency);
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
      className="flex w-full max-w-xl flex-col gap-5"
    >
      <input type="hidden" name="groupId" value={groupId} />
      {/* Only submit a splitRule when we actually have a materialized split.
          In DRAFT mode the row amounts are all zero, which would fail the
          EXACT-rule "min 1 amount" validation server-side. */}
      {!isDraftMode && (
        <input type="hidden" name="splitRule" value={ruleJson} />
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

      {/* ─── Row 2: Amount | Currency | Payer | Attach receipts ──── */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
        {!isDraftMode && (
          <div className="grid gap-2">
            <Label htmlFor="amount">{t('expenses.amount')}</Label>
            <Input
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </div>
        )}
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
        <div>
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
            <Paperclip /> {t('expenses.attach_receipts')}
          </Button>
        </div>
      </div>

      {!isDraftMode && currency !== groupCurrency && (
        <div className="grid gap-2">
          <Label htmlFor="fxRateOverride">{t('expenses.fx_rate_override')}</Label>
          <Input
            id="fxRateOverride"
            name="fxRateOverride"
            inputMode="decimal"
            placeholder={t('expenses.fx_rate_hint', { from: currency, to: groupCurrency })}
            defaultValue={defaults?.fxRateOverride ?? ''}
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
      <fieldset className="grid gap-3 rounded-md border p-4">
        <legend className="px-2 text-sm font-medium">{t('expenses.split_rule')}</legend>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={btnToggleAll}>
            {rows.every((r) => r.checked)
              ? t('expenses.btn_deselect_all')
              : t('expenses.btn_select_all')}
          </Button>
          <div className="flex items-center gap-3 text-sm" role="radiogroup">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="split-mode"
                value="EQUAL"
                checked={mode === 'EQUAL'}
                onChange={() => setMode('EQUAL')}
                className="size-4"
              />
              {t('expenses.mode_equal')}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="split-mode"
                value="RATIO"
                checked={mode === 'RATIO'}
                onChange={() => setMode('RATIO')}
                className="size-4"
              />
              {t('expenses.mode_ratio')}
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="w-7 px-1 py-1 text-left"></th>
                <th className="px-2 py-1 text-left font-medium">
                  {t('expenses.col_member')}
                </th>
                {mode === 'RATIO' && (
                  <th className="w-14 px-1 py-1 text-right font-medium">
                    {t('expenses.col_shares')}
                  </th>
                )}
                <th className="w-24 px-1 py-1 text-right font-medium">
                  {t('expenses.col_base')}
                </th>
                <th className="w-24 px-1 py-1 text-right font-medium">
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
                // Subtotal includes extras even when unchecked.
                const hasContribution = r.checked || perMemberFinal[i]! > 0n;
                const baseShown = r.checked ? r.baseText || formatMinor(0n, currency) : null;
                return (
                  <tr key={r.memberId} className="border-t">
                    <td className="px-1 py-1">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={r.checked}
                        onChange={(e) =>
                          updateRow(r.memberId, {
                            checked: e.target.checked,
                            shares: e.target.checked ? r.shares || '1' : '0',
                            baseText: e.target.checked ? r.baseText : '',
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-1 font-medium">{m.displayName}</td>
                    {mode === 'RATIO' && (
                      <td className="px-1 py-1">
                        <Input
                          value={r.shares}
                          onChange={(e) =>
                            updateRow(r.memberId, {
                              shares: e.target.value.replace(/\D/g, ''),
                            })
                          }
                          inputMode="numeric"
                          disabled={!r.checked}
                          className="h-8 w-full px-2 text-right tabular-nums"
                        />
                      </td>
                    )}
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {baseShown ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-1 py-1">
                      <div className="relative">
                        <Input
                          value={r.extraText}
                          onChange={(e) => updateRow(r.memberId, { extraText: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="h-8 w-full pr-7 pl-2 text-right tabular-nums font-mono"
                        />
                        {r.extraText && (
                          <button
                            type="button"
                            onClick={() => updateRow(r.memberId, { extraText: '' })}
                            aria-label={t('expenses.clear')}
                            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 grid -translate-y-1/2 place-items-center rounded p-0.5"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">
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
                <td
                  colSpan={mode === 'RATIO' ? 4 : 3}
                  className="px-2 py-1.5 text-right text-xs"
                >
                  {t('expenses.split_total')}
                </td>
                <td className="px-1 py-1.5 text-right font-mono text-xs tabular-nums whitespace-nowrap">
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
                  className={`px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
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
