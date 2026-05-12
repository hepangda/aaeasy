'use client';

/**
 * One-click draft fill panel.
 *
 * Shows every DRAFT expense the current caller is allowed to settle and
 * lets them type an amount per row. A single "Save all" button posts the
 * whole batch to {@link fillDraftsAction}, which converts each draft into
 * a fully-materialized expense (using an EQUAL split across all current
 * members). Per-row failures are reported back via toast.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useFormatter } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fillDraftsAction } from '@/lib/expenses/actions';
import { showI18nError, successToast } from '@/lib/ui/toast';

export interface DraftRow {
  expenseId: string;
  title: string;
  occurredAt: Date;
  currency: string;
  payerName: string;
}

export function DraftFillPanel({
  groupId,
  drafts,
}: {
  groupId: string;
  drafts: DraftRow[];
}) {
  const t = useTranslations();
  const fmt = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  if (drafts.length === 0) return null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const items = drafts
      .map((d) => ({
        expenseId: d.expenseId,
        amount: (amounts[d.expenseId] ?? '').trim(),
      }))
      .filter((i) => i.amount.length > 0);
    if (items.length === 0) {
      showI18nError(t, 'errors.invalid_amount');
      return;
    }
    startTransition(async () => {
      const res = await fillDraftsAction({ groupId, items });
      if (res.failed && res.failed.length > 0) {
        showI18nError(t, res.failed[0]!.error);
      }
      if (res.ok) {
        successToast(
          t('expenses.draft_filled_count', { count: res.filled?.length ?? 0 }),
        );
        // Clear the inputs we just saved.
        setAmounts((cur) => {
          const next = { ...cur };
          for (const id of res.filled ?? []) delete next[id];
          return next;
        });
        router.refresh();
      } else if (!res.failed) {
        showI18nError(t, res.error ?? 'errors.unknown');
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-secondary/40 flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {t('expenses.drafts_to_fill', { count: drafts.length })}
        </h2>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t('expenses.submitting') : t('expenses.fill_all')}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {t('expenses.drafts_hint')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <colgroup>
            <col className="w-[88px]" />
            <col />
            <col className="w-[120px]" />
            <col className="w-[160px]" />
          </colgroup>
          <thead className="text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">
                {t('expenses.date')}
              </th>
              <th className="px-2 py-1.5 text-left font-medium">
                {t('expenses.title_field')}
              </th>
              <th className="px-2 py-1.5 text-left font-medium">
                {t('expenses.payer')}
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                {t('expenses.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.expenseId} className="border-t align-middle">
                <td className="text-muted-foreground px-2 py-2 whitespace-nowrap tabular-nums">
                  {fmt.dateTime(d.occurredAt, 'short')}
                </td>
                <td className="px-2 py-2">
                  <span className="font-medium">{d.title}</span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{d.payerName}</td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-muted-foreground text-xs">
                      {d.currency}
                    </span>
                    <Input
                      inputMode="decimal"
                      placeholder="0.00"
                      className="h-8 w-24 text-right tabular-nums"
                      value={amounts[d.expenseId] ?? ''}
                      onChange={(e) =>
                        setAmounts((cur) => ({
                          ...cur,
                          [d.expenseId]: e.target.value,
                        }))
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
