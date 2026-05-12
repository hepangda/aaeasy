'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Check, Copy, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  addSettlementEntryAction,
  deleteSettlementEntryAction,
} from '@/lib/settle/entry-actions';
import { showI18nError } from '@/lib/ui/toast';

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
  const [from, setFrom] = useState(members[0]?.id ?? '');
  const [to, setTo] = useState(members[1]?.id ?? members[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

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
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ─── Suggested clearing instructions ─────────────────────── */}
      <section className="flex flex-col gap-2">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('settlements.suggested')}</h3>
          {suggested.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={copyAll}>
              <Copy /> {copied ? t('settlements.copied') : t('settlements.copy_all')}
            </Button>
          )}
        </header>
        {suggested.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
            {t('summary.transfers_empty')}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {suggested.map((s, i) => {
              const involves =
                !boundMemberId ||
                s.fromMemberId === boundMemberId ||
                s.toMemberId === boundMemberId;
              return (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{s.fromName}</span>
                    <ArrowRight className="text-muted-foreground size-4" />
                    <span className="font-medium">{s.toName}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono tabular-nums whitespace-nowrap">
                      {s.amountText}
                    </span>
                    {canEdit && involves && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => execute(s)}
                        disabled={pending}
                        className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      >
                        <Check /> {t('settlements.execute')}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── Executed entries + manual add ──────────────────────────── */}
      <section className="flex flex-col gap-2">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('settlements.executed')}</h3>
          {canEdit && !manualOpen && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setManualOpen(true)}
            >
              <Plus /> {t('settlements.add_entry')}
            </Button>
          )}
        </header>

        {manualOpen && canEdit && (
          <form
            onSubmit={submitManual}
            className="bg-muted/30 grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto_1fr_120px_auto]"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="se-from" className="text-xs">
                {t('settlements.from')}
              </Label>
              <Select id="se-from" value={from} onChange={(e) => setFrom(e.target.value)}>
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
              <Select id="se-to" value={to} onChange={(e) => setTo(e.target.value)}>
                {members.map((m) => (
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
              <Input
                id="se-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </div>
            <div className="flex items-end gap-1">
              <Button type="submit" disabled={pending}>
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
          <ul className="divide-y rounded-md border">
            {executed.map((e) => {
              const involves =
                !boundMemberId ||
                e.fromMemberId === boundMemberId ||
                e.toMemberId === boundMemberId;
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{e.fromName}</span>
                      <ArrowRight className="text-muted-foreground size-4" />
                      <span className="font-medium">{e.toName}</span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {e.occurredAt}
                      {e.createdByName ? ` · ${e.createdByName}` : ''}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                  </div>
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums whitespace-nowrap">
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
                      <Trash2 className="text-destructive" />
                    </Button>
                  )}
                </span>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
