'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AtSign,
  Copy,
  Link as LinkIcon,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Tabs, type TabDefinition } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  createMemberShareLinkAction,
  revokeShareLinkAction,
} from '@/lib/groups/share-actions';
import {
  inviteUserToMemberAction,
  cancelInvitationAction,
  type InvitationRole,
} from '@/lib/invitations/actions';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { showI18nError, successToast } from '@/lib/ui/toast';
import type { ExistingShareLink } from './types';
import type { MemberPendingInvitationRow } from '@/lib/invitations/queries';

const EXPIRES_OPTIONS = [
  { value: '24', i18n: 'share.expires_24h' as const },
  { value: '48', i18n: 'share.expires_48h' as const },
  { value: '72', i18n: 'share.expires_72h' as const },
  { value: 'READ_ONLY', i18n: 'share.expires_read_only' as const },
] as const;

// VIEWER is intentionally absent from both account-binding flows. Use the
// ledger-level <GroupShareDialog> for read-only access. With only two
// possible roles we render a 2-button segmented control instead of a
// <Select> — fewer clicks, both choices visible.
const ROLE_OPTIONS: InvitationRole[] = ['MANAGER', 'MEMBER'];

interface UserSearchHit {
  username: string;
  displayName: string;
}

/**
 * Per-member "account binding" dialog. Two tabs:
 *   1. Invite by @username (primary) — sends a GroupInvitation; the target
 *      user accepts it from /groups.
 *   2. Share link (fallback) — generates a single-use claim URL for people
 *      who don't have an account yet.
 *
 * Hidden entirely when the member is already linked. Existing pending
 * invitations / share links for this member are surfaced in both tabs so
 * a manager can revoke whichever they don't want anymore.
 */
export function AccountBindingDialog({
  groupId,
  memberId,
  memberName,
  canAssignManager,
  existingLinks,
  pendingInvitations,
  baseUrl,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  canAssignManager: boolean;
  existingLinks: ExistingShareLink[];
  pendingInvitations: MemberPendingInvitationRow[];
  baseUrl: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const confirmDialog = useConfirm();
  const [open, setOpen] = useState(false);

  const activeLinks = existingLinks.filter((l) => !l.expired && !l.revoked);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t('binding.button_label')}
        title={t('binding.button_label')}
      >
        <LinkIcon />
        {(activeLinks.length > 0 || pendingInvitations.length > 0) && (
          <span className="ml-1 text-xs">
            {activeLinks.length + pendingInvitations.length}
          </span>
        )}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('binding.dialog_title_for', { name: memberName })}
        className="max-w-lg"
      >
        <Tabs
          tabs={[
            {
              id: `bind-invite-${memberId}`,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <AtSign className="size-3.5" />
                  {t('binding.tab_invite')}
                </span>
              ),
              badge:
                pendingInvitations.length > 0
                  ? pendingInvitations.length
                  : undefined,
              content: (
                <InviteTab
                  groupId={groupId}
                  memberId={memberId}
                  canAssignManager={canAssignManager}
                  pendingInvitations={pendingInvitations}
                  onChanged={() => router.refresh()}
                  confirmDialog={confirmDialog}
                />
              ),
            },
            {
              id: `bind-link-${memberId}`,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <LinkIcon className="size-3.5" />
                  {t('binding.tab_share_link')}
                </span>
              ),
              badge: activeLinks.length > 0 ? activeLinks.length : undefined,
              content: (
                <ShareLinkTab
                  groupId={groupId}
                  memberId={memberId}
                  memberName={memberName}
                  canAssignManager={canAssignManager}
                  existingLinks={existingLinks}
                  baseUrl={baseUrl}
                  onChanged={() => router.refresh()}
                  confirmDialog={confirmDialog}
                />
              ),
            },
          ] satisfies TabDefinition[]}
        />
      </Dialog>
    </>
  );
}

// ─── Invite tab ──────────────────────────────────────────────────────────

function InviteTab({
  groupId,
  memberId,
  canAssignManager,
  pendingInvitations,
  onChanged,
  confirmDialog,
}: {
  groupId: string;
  memberId: string;
  canAssignManager: boolean;
  pendingInvitations: MemberPendingInvitationRow[];
  onChanged: () => void;
  confirmDialog: ReturnType<typeof useConfirm>;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<InvitationRole>('MEMBER');
  const [suggestions, setSuggestions] = useState<UserSearchHit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);

  // Debounced suggestions: only fire when input length >= 3 chars
  // (server-side guard mirrors this). Cleared on input change before the
  // debounce timeout to avoid showing stale results.
  useEffect(() => {
    const trimmed = username.trim().replace(/^@/, '');
    if (trimmed.length < 3) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (cancelled) return;
        if (!res.ok) throw new Error('search failed');
        const body = (await res.json()) as { users: UserSearchHit[] };
        if (cancelled) return;
        setSuggestions(body.users);
      } catch {
        if (cancelled) return;
        setSuggestions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [username]);

  // Derive whether the dropdown should show: cleared as soon as the buffer
  // drops below 3 chars without needing a setState in an effect.
  const showSuggestionsList =
    showSuggestions &&
    username.trim().replace(/^@/, '').length >= 3 &&
    suggestions.length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const trimmed = username.trim().replace(/^@/, '');
    if (!trimmed) return;
    startTransition(async () => {
      const res = await inviteUserToMemberAction({
        groupId,
        memberId,
        username: trimmed,
        assignedRole: role,
      });
      if (res.ok) {
        successToast(t('binding.invite_success'));
        setUsername('');
        setSuggestions([]);
        onChanged();
      } else {
        showI18nError(t, res.error ?? 'errors.unknown');
      }
    });
  }

  function cancel(id: string) {
    if (pending) return;
    confirmDialog({ message: t('binding.confirm_cancel') }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        const res = await cancelInvitationAction({ groupId, invitationId: id });
        if (!res.ok) showI18nError(t, res.error ?? 'errors.unknown');
        onChanged();
      });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t('binding.invite_desc')}</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`bind-username-${memberId}`} className="text-xs">
            {t('binding.username_label')}
          </Label>
          <div className="relative">
            <Input
              id={`bind-username-${memberId}`}
              autoComplete="off"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              className="pr-8"
            />
            {searching && (
              <Loader2 className="text-muted-foreground absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin" />
            )}
            {showSuggestionsList && (
              <ul className="border-input bg-popover absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border shadow-md">
                {suggestions.map((s) => (
                  <li key={s.username}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setUsername(s.username);
                        setSuggestions([]);
                        setShowSuggestions(false);
                      }}
                      className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                    >
                      <AtSign className="text-muted-foreground size-3.5" />
                      <span className="font-medium">{s.username}</span>
                      <span className="text-muted-foreground truncate text-xs">
                        {s.displayName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid gap-1">
          <Label className="text-xs">{t('binding.assigned_role')}</Label>
          <RoleSegmented
            value={role}
            onChange={setRole}
            canAssignManager={canAssignManager}
          />
        </div>

        <Button type="submit" size="sm" disabled={pending} className="self-start">
          <UserPlus />
          {pending ? t('binding.inviting') : t('binding.invite_button')}
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">{t('binding.pending_section')}</h3>
        {pendingInvitations.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('binding.no_pending_invites')}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {pendingInvitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-foreground text-sm font-medium leading-tight">
                    {inv.invitedUser.displayName}
                    <span className="text-muted-foreground ml-1 font-normal">
                      @{inv.invitedUser.username}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {t('binding.pending_status')}
                    {' · '}
                    {t(`members.role.${inv.assignedRole}` as never)}
                  </span>
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => cancel(inv.id)}
                  disabled={pending}
                  aria-label={t('binding.cancel_invitation')}
                >
                  <X className="text-destructive size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Share-link tab (legacy fallback) ────────────────────────────────────

function ShareLinkTab({
  groupId,
  memberId,
  memberName,
  canAssignManager,
  existingLinks,
  baseUrl,
  onChanged,
  confirmDialog,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  canAssignManager: boolean;
  existingLinks: ExistingShareLink[];
  baseUrl: string;
  onChanged: () => void;
  confirmDialog: ReturnType<typeof useConfirm>;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [expires, setExpires] = useState<string>('24');
  const [assignedRole, setAssignedRole] = useState<InvitationRole>('MEMBER');
  const [label, setLabel] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setShowForm(false);
    setExpires('24');
    setAssignedRole('MEMBER');
    setLabel('');
  }

  function generate(ev: FormEvent) {
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
        onChanged();
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
        onChanged();
      });
    });
  }

  async function copyLink(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t('binding.link_desc')}</p>

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
        <p className="text-muted-foreground text-xs">{t('share.no_active_links')}</p>
      )}

      {showForm ? (
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
              <Label className="text-xs">{t('share.assigned_role')}</Label>
              <RoleSegmented
                value={assignedRole}
                onChange={setAssignedRole}
                canAssignManager={canAssignManager}
              />
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
    </div>
  );
}

// ─── Role segmented control ──────────────────────────────────────────────

/**
 * Two-button segmented control for picking MANAGER vs MEMBER. Faster than a
 * <Select> when there are only two choices — both options are visible and
 * one click commits the pick. MANAGER is hidden unless the caller is OWNER
 * (mirrors the server-side guard).
 */
function RoleSegmented({
  value,
  onChange,
  canAssignManager,
}: {
  value: InvitationRole;
  onChange: (next: InvitationRole) => void;
  canAssignManager: boolean;
}) {
  const t = useTranslations();
  const options = ROLE_OPTIONS.filter((r) => canAssignManager || r !== 'MANAGER');
  return (
    <div
      role="radiogroup"
      className="border-input bg-background inline-flex h-10 rounded-md border p-0.5"
    >
      {options.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(r)}
            className={cn(
              'rounded px-3 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`members.role.${r}` as never)}
          </button>
        );
      })}
    </div>
  );
}
