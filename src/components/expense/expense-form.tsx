import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/router/navigation';
import Link from '@/router/link';
import { useTranslations } from 'use-intl';
import { Minus, Plus, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { Eyebrow } from '@/components/ui/eyebrow';
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
import { showI18nError } from '@/lib/ui/toast';
import { describeSplitIntent } from '@/lib/split/intent';
import { distribute, parseMajorMinor, parseSignedMajorMinor } from '@/lib/split/allocate';
import type { SplitRule } from '@aaeasy/core/split-types';
import type { SplitInputState } from '@aaeasy/core/split-input-state';
import { computeSplit } from '@aaeasy/core/split';
import { formatMinor, minorUnits } from '@aaeasy/core/money';

type Member = { id: string; displayName: string };

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
  const [amountText, setAmountText] = useState(defaults?.amountText ?? '');
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
      for (const r of cur) {
        const v = parseSignedMajorMinor(r.extraText, currency);
        extrasSum += v === null ? 0n : v;
      }
      const remaining = totalMinor - extrasSum;
      if (remaining < 0n) {
        return cur.map((r) => ({ ...r, baseText: r.checked ? formatMinor(0n, currency) : '' }));
      }
      const weights = cur.map((r) => {
        if (!r.checked) return 0;
        const n = parseInt(r.shares || '0', 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      });
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

  // Navigate away once the action reports success.
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (!state.ok || !state.expenseId || navigatedRef.current) return;
    navigatedRef.current = true;
    router.push(`/groups/${groupId}`);
  }, [state.ok, state.expenseId, groupId, router]);

  // NOTE: on touch devices `NumericInput` renders readOnly (it drives a custom
  // keypad), and readOnly controls are excluded from HTML constraint
  // validation — so `required` on the amount field never fires on a phone.
  // The gate below is therefore the *only* thing stopping an empty amount, and
  // must stay explicit rather than relying on the browser.
  const amountMissing = totalMinor === null;
  const submitDisabled = pending || amountMissing || !sumMatchesTotal;

  // Why the submit button is inert, phrased for the user. Null when it isn't.
  const blockingReason = (() => {
    if (pending) return null;
    if (anyParseError) return t('errors.invalid_amount');
    if (totalMinor === null) return t('expenses.amount_required');
    if (!sumMatchesTotal) {
      return t('expenses.split_diff', {
        diff: `${diffMinor < 0n ? '+' : ''}${formatMinor(-diffMinor, currency)}`,
        currency,
      });
    }
    return null;
  })();

  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      action={formAction}
      ref={formRef}
      className="bg-card relative flex w-full flex-col overflow-hidden rounded-2xl border pb-36 md:pb-0"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="splitRule" value={ruleJson} />
      <input type="hidden" name="splitInputState" value={splitInputStateJson} />
      {defaults && <input type="hidden" name="expenseId" value={defaults.expenseId} />}
      {defaults && <input type="hidden" name="expectedVersion" value={defaults.version ?? 0} />}

      {/* ─── Amount | Currency | Payer ─────────────────────────────
          Mobile: amount + currency share one row, then payer below.
          Desktop keeps them on a single three-column row.

          This is the first thing in the card, so it runs flush to the top
          edge: a margin here would leave a bare strip of card above it with
          nothing in it. Only the bottom border remains for the same reason. */}
      <section className="bg-sunken flex flex-col gap-4 border-b px-5 py-6 sm:grid sm:grid-cols-[1.35fr_auto_1fr] sm:items-end sm:px-8 sm:py-7">
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
                variant="display"
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
                className="w-24 font-mono sm:w-40"
              />
            </div>
          </div>
        </div>
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
          <DatePicker
            id="occurredAt"
            name="occurredAt"
            required
            aria-label={t('expenses.date')}
            defaultValue={
              defaults ? defaults.occurredAt.toISOString().slice(0, 10) : todayLocalISO()
            }
          />
        </div>
      </section>

      {currency !== groupCurrency && (
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

      {/* ─── Split rule ──────────────── */}
      {/* A rendered `legend` is painted *on* the fieldset's top border, which
          left the label straddling the card and the tinted box. The legend
          stays for assistive tech; the visible heading is an ordinary first
          line inside the box. */}
      <fieldset className="bg-sunken-strong mx-5 mb-6 grid gap-4 rounded-lg border p-4 sm:mx-8 sm:p-5">
        <legend className="sr-only">{t('expenses.split_rule')}</legend>
        <p className="text-sm font-semibold" aria-hidden="true">
          {t('expenses.split_rule')}
        </p>

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

            {/* One tree at every width. Below `md` each member is a stacked
                card with its own inline labels; at `md` the same blocks align
                into columns under a shared grid template. The previous dual
                render duplicated every field across a table and a card list. */}
            <div
              aria-hidden="true"
              className="text-muted-foreground hidden gap-3 px-2.5 pb-1 md:grid md:grid-cols-[2.75rem_minmax(0,1fr)_8rem_6rem_7rem_7rem] md:items-end"
            >
              <span />
              <Eyebrow as="span">{t('expenses.col_member')}</Eyebrow>
              <Eyebrow as="span" className="text-center">
                {t('expenses.col_shares')}
              </Eyebrow>
              <Eyebrow as="span" className="text-right">
                {t('expenses.col_base')}
              </Eyebrow>
              <Eyebrow as="span" className="text-right">
                {t('expenses.col_extra')}
              </Eyebrow>
              <Eyebrow as="span" className="text-right">
                {t('expenses.col_subtotal')}
              </Eyebrow>
            </div>

            <ul className="flex flex-col gap-2 md:gap-0">
              {rows.map((r, i) => {
                const m = members.find((x) => x.id === r.memberId);
                if (!m) return null;
                const finalMinor = perMemberFinal[i]!;
                const hasContribution = r.checked || finalMinor > 0n;
                const baseShown = r.checked ? r.baseText || formatMinor(0n, currency) : null;
                return (
                  <li
                    key={r.memberId}
                    className={cn(
                      'flex flex-col gap-2 rounded-md border p-2.5',
                      'md:grid md:grid-cols-[2.75rem_minmax(0,1fr)_8rem_6rem_7rem_7rem] md:items-center md:gap-3 md:rounded-none md:border-0 md:border-t md:px-2.5 md:py-1.5',
                      r.checked ? 'bg-card' : 'bg-muted/30 md:bg-transparent',
                    )}
                  >
                    <div className="flex items-center gap-2.5 md:contents">
                      <Checkbox
                        checked={r.checked}
                        onChange={(e) => setChecked(r.memberId, e.target.checked)}
                        aria-label={t('expenses.member_field', {
                          name: m.displayName,
                          field: t('expenses.split_rule'),
                        })}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {m.displayName}
                      </span>
                      {/* Subtotal sits beside the name on mobile, but in the
                          last column on desktop — hence the two renders of a
                          single value, not of a whole row. */}
                      <span className="text-right font-mono text-sm whitespace-nowrap tabular-nums md:order-last">
                        {hasContribution ? (
                          <>
                            <span className="text-muted-foreground mr-1 text-xs md:hidden">
                              {currency}
                            </span>
                            {formatMinor(finalMinor, currency)}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 md:contents">
                      <div className="flex flex-col gap-1 md:block">
                        <Eyebrow as="span" className="md:hidden">
                          {t('expenses.col_shares')}
                        </Eyebrow>
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

                      <span className="text-muted-foreground hidden text-right font-mono text-sm tabular-nums md:block">
                        {baseShown ?? '—'}
                      </span>

                      <div className="flex flex-col gap-1 md:block">
                        <Eyebrow as="span" className="md:hidden">
                          {t('expenses.col_extra')}
                        </Eyebrow>
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

            <div className="border-border flex items-center justify-between gap-3 border-t pt-2 text-sm">
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

      {/* On mobile the bar is pinned to the viewport bottom; the form reserves
          matching space below the last field (see `pb-36` on the form) so
          nothing ends up underneath it. From `md` up it rides in normal flow. */}
      <div className="bg-card/95 pb-safe-3 fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 backdrop-blur-lg md:static md:z-10 md:px-8 md:pt-4 md:pb-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {/* The reason Save is disabled must be visible *here*. It used to live
              only inside the split editor, which defaults to collapsed — so a
              1-cent mismatch showed the user a dead button and no explanation
              anywhere on screen. */}
          {blockingReason && (
            <p
              role="alert"
              className="text-destructive-ink flex items-center gap-1.5 text-xs sm:mr-auto"
            >
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              {blockingReason}
            </p>
          )}
          {/* Leaving the composer is a bottom-bar action at every width rather
              than a header back link, so the header can keep naming the group
              instead of the form. Save keeps the lion's share of the width. */}
          <div className="flex items-center gap-2 sm:contents">
            <Button asChild type="button" variant="outline" size="lg">
              <Link href={`/groups/${groupId}`}>{t('common.back')}</Link>
            </Button>
            <Button
              type="submit"
              disabled={submitDisabled}
              size="lg"
              className="flex-1 sm:w-auto sm:min-w-40 sm:flex-none"
            >
              {pending ? t('expenses.submitting') : t('expenses.submit')}
            </Button>
          </div>
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
        className="w-full min-w-0 flex-1 border-x bg-transparent text-center font-mono text-sm tabular-nums focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
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
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 grid -translate-y-1/2 place-items-center rounded-md p-0.5"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
