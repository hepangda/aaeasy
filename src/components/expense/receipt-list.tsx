'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { upload } from '@vercel/blob/client';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { errorToast } from '@/lib/ui/toast';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
]);

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
      return 'heic';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

function buildReceiptPathname(groupId: string, expenseId: string, mime: string): string {
  const id = crypto.randomUUID().replaceAll('-', '');
  return `group/${groupId}/expense/${expenseId}/${id}.${extFromMime(mime)}`;
}

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
  const confirm = useConfirm();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

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
        setUploading(true);
        const blob = await upload(buildReceiptPathname(groupId, expenseId, file.type), file, {
          access: 'private',
          contentType: file.type,
          handleUploadUrl: `/api/groups/${groupId}/expenses/${expenseId}/receipts/sign`,
          clientPayload: JSON.stringify({ mime: file.type, size: file.size }),
        });

        const confirmRes = await fetch(`/api/groups/${groupId}/expenses/${expenseId}/receipts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: blob.pathname, mime: file.type, size: file.size }),
        });
        if (!confirmRes.ok) throw new Error('CONFIRM_FAILED');
      } catch {
        errorToast(t('upload_failed'));
      }
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!(await confirm({ message: t('confirm_remove_receipt') }))) return;
    await fetch(`/api/groups/${groupId}/expenses/${expenseId}/receipts/${id}`, {
      method: 'DELETE',
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {receipts.map((r) => (
          <li key={r.id} className="group relative">
            {r.mime.startsWith('image/') ? (
              <a
                href={`/api/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}`}
                target="_blank"
                rel="noopener"
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
                rel="noopener"
                className="bg-muted text-muted-foreground hover:bg-accent flex size-16 items-center justify-center rounded border text-xs"
              >
                <FileText className="size-6" />
              </a>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => remove(r.id)}
                className="bg-background/90 absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border shadow group-hover:flex"
                aria-label={t('remove_receipt')}
              >
                <Trash2 className="text-destructive size-3" />
              </button>
            )}
          </li>
        ))}
        {canEdit && (
          <li>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
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
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      )}
      {receipts.length === 0 && !canEdit && null}
    </div>
  );
}
