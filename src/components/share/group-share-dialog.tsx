import { useState, useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import { Copy, Forward, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createGroupShareLinkAction, revokeShareLinkAction } from '@/spa/actions/shares';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { showI18nError } from '@/lib/ui/toast';
import type { ExistingShareLink } from './types';

export function GroupShareDialog({
  groupId,
  existingLinks,
  baseUrl,
}: {
  groupId: string;
  existingLinks: ExistingShareLink[];
  baseUrl: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const confirmDialog = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setShowForm(false);
    setLabel('');
  }

  function generate(ev: React.FormEvent) {
    ev.preventDefault();
    if (pending) return;
    const fd = new FormData();
    fd.set('groupId', groupId);
    if (label.trim()) fd.set('label', label.trim());
    startTransition(async () => {
      const res = await createGroupShareLinkAction({ ok: false }, fd);
      if (res.ok && res.token) {
        setRevealedToken(res.token);
        reset();
        router.refresh();
      } else {
        showI18nError(t, res.error ?? 'errors.unknown');
      }
    });
  }

  function revoke(linkId: string) {
    if (pending) return;
    confirmDialog({ message: t('share.confirm_revoke') }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        const res = await revokeShareLinkAction({ groupId, shareLinkId: linkId });
        if (!res.ok) showI18nError(t, res.error ?? 'errors.unknown');
        router.refresh();
      });
    });
  }

  async function copyLink(linkText: string) {
    try {
      await navigator.clipboard.writeText(linkText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showI18nError(t, 'errors.unknown');
    }
  }

  const activeLinks = existingLinks.filter((l) => !l.expired && !l.revoked);
  const expiredLinks = existingLinks.filter((l) => l.expired && !l.revoked);
  const revokedLinks = existingLinks.filter((l) => l.revoked);
  const sortedLinks = [...activeLinks, ...expiredLinks, ...revokedLinks];

  function statusLabel(l: ExistingShareLink): string {
    if (l.revoked) return t('share.status_revoked');
    if (l.expired) return t('share.status_expired_read_only');
    return t('share.status_read_only');
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Forward />
        {t('share.group_share')}
        {activeLinks.length > 0 && (
          <span className="text-muted-foreground text-xs">{activeLinks.length}</span>
        )}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
          setRevealedToken(null);
        }}
        title={t('share.group_dialog_title')}
        className="max-w-lg"
      >
        <p className="text-muted-foreground text-xs">{t('share.group_dialog_desc')}</p>

        {revealedToken && (
          <div className="border-foreground/30 bg-secondary/40 flex flex-col gap-2 rounded-md border-2 border-dashed p-3">
            <p className="text-xs">{t('share.link_one_time_warning')}</p>
            <div className="flex flex-col gap-1.5 sm:flex-row">
              <Input
                readOnly
                value={`${baseUrl}/s/${revealedToken}`}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyLink(`${baseUrl}/s/${revealedToken}`)}
              >
                <Copy />
                {copied ? t('share.copied') : t('share.copy')}
              </Button>
            </div>
          </div>
        )}

        {sortedLinks.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {sortedLinks.map((l) => {
              const tone = l.revoked
                ? 'text-muted-foreground/70 line-through'
                : l.expired
                  ? 'text-muted-foreground'
                  : '';
              return (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <span className={`flex flex-col gap-0.5 ${tone}`}>
                    <span className="text-foreground text-sm leading-tight font-medium">
                      {l.label ?? t('share.group_default_label')}
                    </span>
                    <span className="text-muted-foreground">
                      {statusLabel(l)}
                      {' · '}
                      {t('share.created_at', { date: l.createdAt })}
                    </span>
                  </span>
                  {!l.revoked && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => revoke(l.id)}
                      disabled={pending}
                      aria-label={t('share.revoke')}
                    >
                      <Trash2 className="text-destructive-ink size-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">{t('share.no_active_links')}</p>
        )}

        {showForm ? (
          <form
            onSubmit={generate}
            className="bg-muted/40 flex flex-col gap-3 rounded-md border p-3"
          >
            <div className="grid gap-1">
              <Label htmlFor="group-share-label" className="text-xs">
                {t('share.label_optional')}
              </Label>
              <Input
                id="group-share-label"
                type="text"
                autoComplete="off"
                maxLength={60}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('share.group_label_placeholder')}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={pending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? t('share.creating') : t('share.create')}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRevealedToken(null);
              setShowForm(true);
            }}
            className="self-start"
          >
            <Plus /> {t('share.create')}
          </Button>
        )}

        <p className="text-muted-foreground border-border/60 border-t pt-3 text-xs">
          {t('share.bind_hint')}{' '}
          <button
            type="button"
            className="text-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setOpen(false);
              reset();
              setRevealedToken(null);
              router.push(`/groups/${groupId}#settings`);
            }}
          >
            {t('share.go_to_settings')}
          </button>
        </p>
      </Dialog>
    </>
  );
}
