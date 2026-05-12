'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  renameCredentialAction,
  type CredentialKind,
} from '@/lib/auth/credential-actions';
import { showI18nError } from '@/lib/ui/toast';

/**
 * Pencil button that opens a modal letting the user rename any sign-in
 * credential (passkey or password). Used inside the unified credential
 * list on the account page.
 */
export function CredentialRenameButton({
  kind,
  credentialId,
  currentLabel,
}: {
  kind: CredentialKind;
  credentialId: string;
  currentLabel: string;
}) {
  const router = useRouter();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(currentLabel);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await renameCredentialAction(kind, credentialId, label);
      if (!res.ok) {
        showI18nError(t, res.error ?? 'errors.unknown');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setLabel(currentLabel);
          setOpen(true);
        }}
        aria-label={t('account.credential_rename')}
      >
        <Pencil />
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('account.credential_rename')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="rename-credential" className="text-sm">
              {t('account.credential_name_label')}
            </Label>
            <Input
              id="rename-credential"
              name="label"
              type="text"
              maxLength={64}
              required
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <footer className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </footer>
        </form>
      </Dialog>
    </>
  );
}
