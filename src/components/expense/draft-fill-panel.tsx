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
import { useRouter } from '@/router/navigation';
import { useTranslations, useFormatter } from 'use-intl';
import { Button } from '@/components/ui/button';
import { NumericInput } from '@/components/ui/numeric-input';
import { Eyebrow } from '@/components/ui/eyebrow';
import { fillDraftsAction } from '@/spa/actions/expenses';
import { showI18nError, successToast } from '@/lib/ui/toast';
import { formatMinor, minorUnits } from '@aaeasy/core/money';

export interface DraftRow {
  expenseId: string;
  title: string;
  occurredAt: Date;
  currency: string;
  payerName: string;
}

export function DraftFillPanel({ groupId, drafts }: { groupId: string; drafts: DraftRow[] }) {
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
        successToast(t('expenses.draft_filled_count', { count: res.filled?.length ?? 0 }));
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
      className="bg-sunken flex flex-col gap-3 rounded-2xl border p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-[-0.025em]">
          {t('expenses.drafts_to_fill', { count: drafts.length })}
        </h2>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t('expenses.submitting') : t('expenses.fill_all')}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t('expenses.drafts_hint')}</p>
      {/* One tree at every width. The old dual render (a card list plus a
          min-w-[480px] table) forced horizontal scroll on narrow tablets and
          duplicated every future column change. */}
      <ul className="divide-border bg-card divide-y rounded-xl border">
        {drafts.map((draft) => (
          <li
            key={draft.expenseId}
            className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{draft.title}</p>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {fmt.dateTime(draft.occurredAt, 'short')} · {draft.payerName}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Eyebrow as="span" mono>
                {draft.currency}
              </Eyebrow>
              <NumericInput
                aria-label={`${t('expenses.amount')} · ${draft.title}`}
                placeholder={formatMinor(0n, draft.currency)}
                precision={minorUnits(draft.currency)}
                className="w-32 text-right font-mono tabular-nums md:w-36"
                value={amounts[draft.expenseId] ?? ''}
                onChange={(event) =>
                  setAmounts((current) => ({
                    ...current,
                    [draft.expenseId]: event.target.value,
                  }))
                }
                keypadTitle={draft.title}
              />
            </div>
          </li>
        ))}
      </ul>
    </form>
  );
}
