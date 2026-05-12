'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteAccountAction } from '@/lib/auth/account-actions';

export function DeleteAccountButton({
  ownedGroups,
}: {
  ownedGroups: { id: string; name: string; memberCount: number }[];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState('');

  // Require the user to type the literal phrase to enable the button.
  // Translated; falls back to "DELETE" if the i18n key is missing.
  const phrase = t('account.delete_confirm_phrase');
  const phraseOk = confirmText.trim() === phrase;

  function doDelete() {
    if (!phraseOk || pending) return;
    startTransition(async () => {
      await deleteAccountAction();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 /> {t('account.delete_button')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirmText('');
        }}
        title={t('account.delete_title')}
        className="max-w-md"
      >
        <p className="text-sm leading-relaxed">{t('account.delete_warning')}</p>

        {ownedGroups.length > 0 ? (
          <div className="border-destructive/40 bg-destructive/10 flex flex-col gap-2 rounded-md border p-3 text-sm">
            <p className="font-medium">
              {t('account.delete_owned_warning', { count: ownedGroups.length })}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {ownedGroups.map((g) => (
                <li key={g.id}>
                  <span className="font-medium">{g.name}</span>{' '}
                  <span className="text-muted-foreground">
                    · {t('groups.members_count', { count: g.memberCount })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {t('account.delete_transfer_hint')}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t('account.delete_no_owned')}</p>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="confirm-phrase" className="text-xs">
            {t('account.delete_type_to_confirm', { phrase })}
          </Label>
          <Input
            id="confirm-phrase"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={phrase}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setConfirmText('');
            }}
            disabled={pending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={doDelete}
            disabled={!phraseOk || pending}
          >
            {pending ? t('account.deleting') : t('account.delete_confirm')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
