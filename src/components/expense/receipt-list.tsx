import { useRef, useState, useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { errorToast, showI18nError } from '@/lib/ui/toast';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
]);

interface Receipt {
  id: string;
  mime: string;
  sizeBytes: number;
}

export function ReceiptList({
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
  const tRoot = useTranslations();
  const confirm = useConfirm();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const busy = uploading || deletingId !== null || refreshing;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;

    setUploading(true);
    let uploaded = false;
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          errorToast(t('file_too_large'));
          continue;
        }
        if (!ALLOWED.has(file.type)) {
          errorToast(t('unsupported_type'));
          continue;
        }
        try {
          const uploadRes = await fetch(`/api/groups/${groupId}/expenses/${expenseId}/receipts`, {
            method: 'POST',
            headers: { 'Content-Type': file.type },
            body: file,
          });
          if (!uploadRes.ok) throw new Error('UPLOAD_FAILED');
          uploaded = true;
        } catch {
          errorToast(t('upload_failed'));
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }

    if (uploaded) startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (busy) return;
    setDeletingId(id);
    try {
      if (!(await confirm({ message: t('confirm_remove_receipt') }))) return;
      const response = await fetch(`/api/groups/${groupId}/expenses/${expenseId}/receipts/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        showI18nError(tRoot, body?.error ?? 'errors.unknown');
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      showI18nError(tRoot, 'errors.unknown');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {receipts.map((r, index) => (
          <li key={r.id} className="group relative">
            {r.mime.startsWith('image/') ? (
              <a
                href={`/api/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t('receipts')} ${index + 1}`}
                className="block overflow-hidden rounded border"
              >
                <img
                  src={`/api/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}`}
                  alt=""
                  className="size-16 object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <a
                href={`/api/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t('receipts')} ${index + 1}`}
                className="bg-muted text-muted-foreground hover:bg-accent flex size-16 items-center justify-center rounded border text-xs"
              >
                <FileText className="size-6" />
              </a>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={busy}
                className="bg-background/90 focus-visible:ring-ring/25 absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border shadow transition-opacity focus-visible:ring-4 focus-visible:outline-hidden disabled:opacity-50 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                aria-label={`${t('remove_receipt')} ${index + 1}`}
              >
                <Trash2 className="text-destructive-ink size-3" />
              </button>
            )}
          </li>
        ))}
        {canEdit && (
          <li>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-label={uploading ? t('uploading') : t('upload_receipt')}
              className="border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground flex size-16 items-center justify-center rounded border-2 border-dashed transition-colors disabled:opacity-50"
            >
              <Plus className="size-6" />
            </button>
          </li>
        )}
      </ul>

      {canEdit && (
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          disabled={busy}
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      )}
      {receipts.length === 0 && !canEdit && null}
    </div>
  );
}
