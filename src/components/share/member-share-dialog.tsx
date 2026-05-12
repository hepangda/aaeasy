'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, Link as LinkIcon, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createMemberShareLinkAction,
  revokeShareLinkAction,
} from '@/lib/groups/share-actions';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { showI18nError } from '@/lib/ui/toast';

import type { ShareScope } from '@prisma/client';

export interface ExistingShareLink {
  id: string;
  memberId: string | null;
  /** Owner-set note (optional). Defaults to the member's display name when
   *  the link was created without one. Never shown to the visitor. */
  label: string | null;
  scope: ShareScope;
  createdAt: string; // formatted
  expiresAt: string | null; // formatted
  /** Past `expiresAt` — link still works but read-only. */
  expired: boolean;
  /** Hard-killed by an OWNER/MANAGER. Visitor gets no access at all. */
  revoked: boolean;
}

const EXPIRES_OPTIONS = [
  { value: '24', i18n: 'share.expires_24h' as const },
  { value: '48', i18n: 'share.expires_48h' as const },
  { value: '72', i18n: 'share.expires_72h' as const },
  { value: 'READ_ONLY', i18n: 'share.expires_read_only' as const },
] as const;

type AssignableRole = 'MANAGER' | 'MEMBER' | 'VIEWER';
const ROLE_OPTIONS: AssignableRole[] = ['MANAGER', 'MEMBER', 'VIEWER'];

/**
 * Per-member 分享 button → modal that lists this member's links and lets
 * the OWNER/MANAGER create new ones, optionally label them, and revoke.
 */
export function MemberShareDialog({
  groupId,
  memberId,
  memberName,
  memberLinked,
  canAssignManager,
  existingLinks,
  baseUrl,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  /** When true the member has already bound to an account; new links
   *  cannot be issued (the create form is hidden) but existing rows are
   *  still shown so they can be revoked. */
  memberLinked: boolean;
  /** Only OWNER may mint MANAGER-grade links. */
  canAssignManager: boolean;
  /** All links belonging to THIS member (active, expired, or revoked). */
  existingLinks: ExistingShareLink[];
  baseUrl: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const confirmDialog = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [expires, setExpires] = useState<string>('24');
  const [assignedRole, setAssignedRole] = useState<AssignableRole>('MEMBER');
  const [label, setLabel] = useState('');
  /** Reveal the freshly minted token (held in memory only). */
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setShowForm(false);
    setExpires('24');
    setAssignedRole('MEMBER');
    setLabel('');
  }

  function generate(ev: React.FormEvent) {
    ev.preventDefault();
    if (pending) return;
    const fd = new FormData();
    fd.set('groupId', groupId);
    fd.set('memberId', memberId);
    fd.set('expires', expires);
    fd.set('assignedRole', assignedRole);
    if (label.trim()) fd.set('label', label.trim());
    startTransition(async () => {
      const res = await createMemberShareLinkAction({ ok: false }, fd);
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
    await navigator.clipboard.writeText(linkText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Show in three buckets: active first, expired next, revoked at the end.
  // All counts go in the badge; only "active" counts visually as a number
  // in the trigger button next to the icon.
  const activeLinks = existingLinks.filter((l) => !l.expired && !l.revoked);
  const expiredLinks = existingLinks.filter((l) => l.expired && !l.revoked);
  const revokedLinks = existingLinks.filter((l) => l.revoked);
  const sortedLinks = [...activeLinks, ...expiredLinks, ...revokedLinks];

  function statusLabel(l: ExistingShareLink): string {
    if (l.revoked) return t('share.status_revoked');
    if (l.expired) return t('share.status_expired_read_only');
    if (l.scope === 'READ') return t('share.status_read_only');
    return t('share.status_active');
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t('share.share')}
        title={t('share.share')}
      >
        <LinkIcon />
        {activeLinks.length > 0 && (
          <span className="ml-1 text-xs">{activeLinks.length}</span>
        )}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
          setRevealedToken(null);
        }}
        title={t('share.dialog_title_for', { name: memberName })}
        className="max-w-lg"
      >
        <p className="text-muted-foreground text-xs">{t('share.dialog_desc')}</p>

        {/* Reveal panel for the just-generated link */}
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

        {/* Existing links list */}
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
                    <span className="text-foreground text-sm font-medium leading-tight">
                      {l.label ?? memberName}
                    </span>
                    <span className="text-muted-foreground">
                      {statusLabel(l)}
                      {' · '}
                      {t('share.created_at', { date: l.createdAt })}
                      {l.expiresAt && (
                        <> · {t('share.expires_at', { date: l.expiresAt })}</>
                      )}
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
                      <Trash2 className="text-destructive size-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t('share.no_active_links')}
          </p>
        )}

        {/* Create form / trigger */}
        {memberLinked ? (
          <p className="text-muted-foreground text-xs">{t('share.member_already_linked')}</p>
        ) : showForm ? (
          <form
            onSubmit={generate}
            className="bg-muted/40 flex flex-col gap-3 rounded-md border p-3"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1">
                <Label htmlFor={`label-${memberId}`} className="text-xs">
                  {t('share.label_optional')}
                </Label>
                <Input
                  id={`label-${memberId}`}
                  type="text"
                  autoComplete="off"
                  maxLength={60}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t('share.label_placeholder')}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`exp-${memberId}`} className="text-xs">
                  {t('share.expires')}
                </Label>
                <Select
                  id={`exp-${memberId}`}
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                >
                  {EXPIRES_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.i18n)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`role-${memberId}`} className="text-xs">
                  {t('share.assigned_role')}
                </Label>
                <Select
                  id={`role-${memberId}`}
                  value={assignedRole}
                  onChange={(e) => setAssignedRole(e.target.value as AssignableRole)}
                >
                  {ROLE_OPTIONS.filter((r) => canAssignManager || r !== 'MANAGER').map((r) => (
                    <option key={r} value={r}>
                      {t(`members.role.${r}` as never)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={reset}
                disabled={pending}
              >
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
      </Dialog>
    </>
  );
}
