'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FloatingPanel } from '@/components/ui/floating-panel';
import { ReceiptList } from '@/components/receipt-list';

interface Receipt {
  id: string;
  mime: string;
  sizeBytes: number;
}

/**
 * Compact button that shows the receipt count and pops a small panel with
 * the existing thumbnail / upload UI when clicked. The panel renders in a
 * portal so it doesn't trigger horizontal scroll inside the table.
 */
export function ReceiptActionsButton({
  groupId,
  expenseId,
  receipts,
  canEdit,
}: {
  groupId: string;
  expenseId: string;
  receipts: Receipt[];
  canEdit: boolean;
}) {
  const t = useTranslations('expenses');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Hide entirely when there's nothing to show or do.
  if (receipts.length === 0 && !canEdit) return null;

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('receipts')}
        aria-expanded={open}
      >
        <Paperclip />
        {receipts.length > 0 && (
          <span className="ml-0.5 text-[10px] tabular-nums">{receipts.length}</span>
        )}
      </Button>
      <FloatingPanel
        open={open}
        anchor={anchorRef.current}
        onClose={() => setOpen(false)}
        align="end"
        className="w-fit max-w-xs"
      >
        <div className="bg-popover rounded-md border p-2 shadow-md">
          <ReceiptList
            groupId={groupId}
            expenseId={expenseId}
            receipts={receipts}
            canEdit={canEdit}
          />
        </div>
      </FloatingPanel>
    </>
  );
}
