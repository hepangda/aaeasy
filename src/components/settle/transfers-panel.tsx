import { useEffect, useState, useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import { ArrowRight, Check, ChevronDown, Copy, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { addSettlementEntryAction, deleteSettlementEntryAction } from '@/spa/actions/settlements';
import { showI18nError } from '@/lib/ui/toast';
import { formatMinor, minorUnits } from '@/lib/money';

export interface MemberLite {
  id: string;
  displayName: string;
}

export interface SuggestedTransfer {
  fromMemberId: string;
  toMemberId: string;
  fromName: string;
  toName: string;
  amountText: string;
  amountMajor: string; // numeric string, used to pre-fill on 执行
}

export interface ExecutedEntry {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  fromName: string;
  toName: string;
  amountText: string;
  occurredAt: string; // formatted for display
  note: string | null;
  createdByName: string | null;
}

export function TransfersPanel({
  groupId,
  members,
  suggested,
  executed,
  defaultCurrency,
  canEdit,
  boundMemberId,
}: {
  groupId: string;
  members: MemberLite[];
  suggested: SuggestedTransfer[];
  executed: ExecutedEntry[];
  defaultCurrency: string;
  canEdit: boolean;
  /** When set (per-member share link), the visitor can only execute /
   *  delete entries that involve this member. Buttons for unrelated rows
   *  are hidden. */
  boundMemberId?: string | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // Manual-add form state.
  const [manualOpen, setManualOpen] = useState(false);
  const [from, setFrom] = useState(boundMemberId ?? members[0]?.id ?? '');
  const [to, setTo] = useState(
    members.find((member) => member.id !== (boundMemberId ?? members[0]?.id))?.id ?? '',
  );
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const memberIdsKey = members.map((member) => member.id).join('|');
  const toOptions =
    boundMemberId && from !== boundMemberId
      ? members.filter((member) => member.id === boundMemberId)
      : members.filter((member) => member.id !== from);
  const manualSelectionValid =
    Boolean(from && to && from !== to) &&
    (!boundMemberId || from === boundMemberId || to === boundMemberId);
  const manualSubmissionReady = manualSelectionValid && amount.trim().length > 0;
  const canAddManual = canEdit && members.length >= 2;

  useEffect(() => {
    const memberIds = memberIdsKey.split('|').filter(Boolean);
    const ids = new Set(memberIds);
    const nextFrom = boundMemberId && ids.has(boundMemberId) ? boundMemberId : (memberIds[0] ?? '');
    const nextTo = memberIds.find((memberId) => memberId !== nextFrom) ?? '';
    setFrom(nextFrom);
    setTo(nextTo);
  }, [boundMemberId, memberIdsKey]);

  function changeFrom(next: string) {
    setFrom(next);
    if (boundMemberId && next !== boundMemberId) {
      setTo(boundMemberId);
      return;
    }
    if (to === next || !members.some((member) => member.id === to)) {
      setTo(members.find((member) => member.id !== next)?.id ?? '');
    }
  }

  function changeTo(next: string) {
    setTo(next);
  }

  function execute(s: SuggestedTransfer) {
    if (!canEdit || pending) return;
    startTransition(async () => {
      const res = await addSettlementEntryAction({
        groupId,
        fromMemberId: s.fromMemberId,
        toMemberId: s.toMemberId,
        amount: s.amountMajor,
      });
      if (!res.ok) showI18nError(t, res.error ?? 'errors.unknown');
      router.refresh();
    });
  }

  function submitManual(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canEdit || pending) return;
    startTransition(async () => {
      const res = await addSettlementEntryAction({
        groupId,
        fromMemberId: from,
        toMemberId: to,
        amount,
        note,
      });
      if (!res.ok) {
        showI18nError(t, res.error ?? 'errors.unknown');
        return;
      }
      setAmount('');
      setNote('');
      setManualOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!canEdit || pending) return;
    confirm({ message: t('settlements.confirm_delete_entry') }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        const res = await deleteSettlementEntryAction({ entryId: id });
        if (!res.ok) showI18nError(t, res.error ?? 'errors.unknown');
        router.refresh();
      });
    });
  }

  async function copyAll() {
    if (suggested.length === 0) return;
    const text = suggested
      .map((s) =>
        t('settlements.transfer_template', {
          from: s.fromName,
          to: s.toName,
          amount: s.amountText,
        }),
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showI18nError(t, 'errors.unknown');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ─── Suggested clearing instructions ─────────────────────── */}
      {suggested.length > 0 ? (
        <section className="flex flex-col gap-2">
          <header className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t('settlements.suggested')}</h3>
            <Button type="button" variant="outline" size="sm" onClick={copyAll}>
              <Copy data-icon="inline-start" />
              {copied ? t('settlements.copied') : t('settlements.copy_all')}
            </Button>
          </header>
          <ul className="divide-y rounded-xl border">
            {suggested.map((s, i) => {
              const involves =
                !boundMemberId ||
                s.fromMemberId === boundMemberId ||
                s.toMemberId === boundMemberId;
              return (
                <li
                  key={i}
                  className="flex flex-col items-stretch gap-2.5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-medium">{s.fromName}</span>
                    <ArrowRight className="text-muted-foreground size-4" />
                    <span className="min-w-0 truncate font-medium">{s.toName}</span>
                  </span>
                  <span className="flex items-center justify-between gap-3 sm:justify-end">
                    <span className="font-mono whitespace-nowrap tabular-nums">{s.amountText}</span>
                    {canEdit && involves && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => execute(s)}
                        disabled={pending}
                        className="border-positive/50 text-positive-ink hover:bg-positive/10 hover:text-positive-ink"
                      >
                        <Check data-icon="inline-start" />
                        {t('settlements.execute')}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ─── Executed entries + manual add ──────────────────────────── */}
      <section className="flex flex-col gap-2">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('settlements.executed')}</h3>
          {canAddManual && !manualOpen && (
            <Button type="button" size="sm" variant="outline" onClick={() => setManualOpen(true)}>
              <Plus data-icon="inline-start" />
              {t('settlements.add_entry')}
            </Button>
          )}
        </header>

        {manualOpen && canAddManual && (
          <form
            onSubmit={submitManual}
            className="bg-muted/30 grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto_1fr_120px_auto]"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="se-from" className="text-xs">
                {t('settlements.from')}
              </Label>
              <Select id="se-from" value={from} onChange={(e) => changeFrom(e.target.value)}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="hidden self-end pb-2 sm:block">
              <ArrowRight className="text-muted-foreground size-4" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="se-to" className="text-xs">
                {t('settlements.to')}
              </Label>
              <Select id="se-to" value={to} onChange={(e) => changeTo(e.target.value)}>
                {toOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="se-amount" className="text-xs">
                {t('expenses.amount')} ({defaultCurrency})
              </Label>
              <NumericInput
                id="se-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={formatMinor(0n, defaultCurrency)}
                required
                precision={minorUnits(defaultCurrency)}
                keypadTitle={t('expenses.amount')}
              />
            </div>
            <div className="flex items-end gap-1">
              <Button type="submit" disabled={pending || !manualSubmissionReady}>
                <Check /> {t('common.save')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setManualOpen(false)}
                disabled={pending}
                aria-label={t('common.cancel')}
              >
                <X />
              </Button>
            </div>
            {!manualSelectionValid ? (
              <p className="text-destructive-ink text-xs sm:col-span-5">
                {t('errors.same_member')}
              </p>
            ) : null}
            <div className="grid gap-1.5 sm:col-span-5">
              <Label htmlFor="se-note" className="text-xs">
                {t('expenses.note')}
              </Label>
              <Input
                id="se-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
              />
            </div>
          </form>
        )}

        {executed.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
            {t('settlements.no_entries')}
          </p>
        ) : (
          <details className="group/history">
            <summary className="text-muted-foreground hover:bg-muted/45 flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl border px-4 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden">
              {t('settlements.recorded_count', { count: executed.length })}
              <ChevronDown className="size-4 transition-transform group-open/history:rotate-180" />
            </summary>
            <ul className="mt-2 divide-y rounded-xl border">
              {executed.map((e) => {
                const involves =
                  !boundMemberId ||
                  e.fromMemberId === boundMemberId ||
                  e.toMemberId === boundMemberId;
                return (
                  <li
                    key={e.id}
                    className="flex flex-col items-stretch gap-2.5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-medium">{e.fromName}</span>
                        <ArrowRight className="text-muted-foreground size-4" />
                        <span className="min-w-0 truncate font-medium">{e.toName}</span>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {e.occurredAt}
                        {e.createdByName ? ` · ${e.createdByName}` : ''}
                        {e.note ? ` · ${e.note}` : ''}
                      </span>
                    </div>
                    <span className="flex items-center justify-between gap-2 sm:justify-end">
                      <span className="font-mono whitespace-nowrap tabular-nums">
                        {e.amountText}
                      </span>
                      {canEdit && involves && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => remove(e.id)}
                          disabled={pending}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="text-destructive-ink" />
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </section>

      <p className="bg-muted/45 text-muted-foreground rounded-xl px-3 py-2.5 text-xs leading-5">
        {t('settlements.record_disclaimer')}
      </p>
    </div>
  );
}
