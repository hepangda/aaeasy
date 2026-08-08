import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'use-intl';
import { AtSign, Copy, Link as LinkIcon, Loader2, Trash2, UserPlus, X } from 'lucide-react';
import { KEYFORGE_ALIAS_MAX_LENGTH, KEYFORGE_ALIAS_MIN_LENGTH } from '@aaeasy/contracts/identity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { showI18nError, successToast } from '@/lib/ui/toast';
import { createMemberShareLinkAction, revokeShareLinkAction } from '@/spa/actions/shares';
import {
  cancelInvitationAction,
  inviteUserToMemberAction,
  type InvitationRole,
} from '@/spa/actions/invitations';
import { TypeChip } from './binding-controls';
import type { GroupRole } from '@aaeasy/contracts';
import type { ExistingShareLink, MemberPendingInvitationRow } from './types';

interface UserSearchHit {
  username: string;
  displayName: string;
}

type SentItem =
  | {
      kind: 'invite';
      id: string;
      createdAt?: never;
      assignedRole: GroupRole;
      pending: MemberPendingInvitationRow;
    }
  | {
      kind: 'link';
      id: string;
      link: ExistingShareLink;
    };

const EXPIRES_OPTIONS = [
  { value: '24', i18n: 'share.expires_24h' as const },
  { value: '48', i18n: 'share.expires_48h' as const },
  { value: '72', i18n: 'share.expires_72h' as const },
  { value: 'READ_ONLY', i18n: 'share.expires_read_only' as const },
] as const;

export function InviteSection({
  groupId,
  memberId,
  role,
  onChanged,
}: {
  groupId: string;
  memberId: string;
  role: InvitationRole;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<UserSearchHit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);

  // Debounced suggestions support the full KeyForge alias range.
  // (server-side guard mirrors this). Cleared on input change before the
  // debounce timeout to avoid showing stale results.
  useEffect(() => {
    const trimmed = username.trim().replace(/^@/, '');
    if (trimmed.length < KEYFORGE_ALIAS_MIN_LENGTH) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`);
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

  const showSuggestionsList =
    showSuggestions &&
    username.trim().replace(/^@/, '').length >= KEYFORGE_ALIAS_MIN_LENGTH &&
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

  return (
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
            maxLength={KEYFORGE_ALIAS_MAX_LENGTH + 1}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setSuggestions([]);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
            className="pr-8"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestionsList}
            aria-controls={`bind-suggestions-${memberId}`}
          />
          {searching && (
            <Loader2 className="text-muted-foreground absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin" />
          )}
          {showSuggestionsList && (
            <ul
              id={`bind-suggestions-${memberId}`}
              role="listbox"
              className="border-input bg-popover shadow-lifted absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border"
            >
              {suggestions.map((s) => (
                <li key={s.username}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={
                      username.replace(/^@/, '').toLowerCase() === s.username.toLowerCase()
                    }
                    onClick={() => {
                      setUsername(s.username);
                      setSuggestions([]);
                      setShowSuggestions(false);
                    }}
                    className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <AtSign className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate font-semibold">{s.username}</span>
                    <span className="text-muted-foreground min-w-0 truncate text-xs">
                      {s.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        <UserPlus />
        {pending ? t('binding.inviting') : t('binding.invite_button')}
      </Button>
    </form>
  );
}

// ─── Share-link section ──────────────────────────────────────────────────

export function ShareLinkSection({
  groupId,
  memberId,
  role,
  baseUrl,
  onChanged,
}: {
  groupId: string;
  memberId: string;
  role: InvitationRole;
  baseUrl: string;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [expires, setExpires] = useState<string>('24');
  const [label, setLabel] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function generate(ev: FormEvent) {
    ev.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const res = await createMemberShareLinkAction(
        { ok: false },
        {
          groupId,
          memberId,
          expires,
          assignedRole: role,
          label: label.trim() || undefined,
        },
      );
      if (res.ok && res.token) {
        setRevealedToken(res.token);
        setLabel('');
        setExpires('24');
        onChanged();
      } else {
        showI18nError(t, res.error ?? 'errors.unknown');
      }
    });
  }

  async function copyLink(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showI18nError(t, 'errors.unknown');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {revealedToken && (
        <div className="border-foreground/30 bg-secondary/40 flex flex-col gap-2 rounded-md border-2 border-dashed p-3">
          <p className="text-xs">{t('share.link_one_time_warning')}</p>
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <Input readOnly value={`${baseUrl}/s/${revealedToken}`} className="font-mono text-xs" />
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

      <form onSubmit={generate} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
        <Button type="submit" size="sm" disabled={pending} className="self-start">
          <LinkIcon />
          {pending ? t('share.creating') : t('share.create')}
        </Button>
      </form>
    </div>
  );
}

// ─── Combined sent list (invitations + share links) ──────────────────────

export function SentList({
  memberName,
  existingLinks,
  pendingInvitations,
  groupId,
  onChanged,
  confirmDialog,
}: {
  memberName: string;
  existingLinks: ExistingShareLink[];
  pendingInvitations: MemberPendingInvitationRow[];
  groupId: string;
  onChanged: () => void;
  confirmDialog: ReturnType<typeof useConfirm>;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();

  // Build a unified list. Pending invites and active links float to the
  // top; expired/revoked links fall to the bottom (they're informational
  // only). Inside each band, newest-first via the upstream queries.
  const items: SentItem[] = [
    ...pendingInvitations.map(
      (inv): SentItem => ({
        kind: 'invite',
        id: inv.id,
        assignedRole: inv.assignedRole,
        pending: inv,
      }),
    ),
    ...existingLinks.map((link): SentItem => ({ kind: 'link', id: link.id, link })),
  ];

  function cancelInvite(id: string) {
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

  function revokeLink(linkId: string) {
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

  function statusLabel(l: ExistingShareLink): string {
    if (l.revoked) return t('share.status_revoked');
    if (l.expired) return t('share.status_expired_read_only');
    if (l.scope === 'READ') return t('share.status_read_only');
    return t('share.status_active');
  }

  return (
    <section className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('binding.sent_empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((item) =>
            item.kind === 'invite' ? (
              <li
                key={`inv-${item.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-foreground flex min-w-0 items-center gap-2 text-sm leading-tight font-semibold">
                    <TypeChip label={t('binding.type_invite')} />
                    <span className="min-w-0 truncate">
                      {item.pending.invitedUser.displayName}
                      <span className="text-muted-foreground ml-1 font-normal">
                        @{item.pending.invitedUser.username}
                      </span>
                    </span>
                  </span>
                  <span className="text-muted-foreground break-words">
                    {t('binding.pending_status')}
                    {' · '}
                    {t(`members.role.${item.assignedRole}` as never)}
                  </span>
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  onClick={() => cancelInvite(item.id)}
                  disabled={pending}
                  aria-label={t('binding.cancel_invitation')}
                >
                  <X className="text-destructive-ink size-3.5" />
                </Button>
              </li>
            ) : (
              <li
                key={`link-${item.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    'flex min-w-0 flex-1 flex-col gap-0.5',
                    item.link.revoked && 'text-muted-foreground/70 line-through',
                    !item.link.revoked && item.link.expired && 'text-muted-foreground',
                  )}
                >
                  <span className="text-foreground flex min-w-0 items-center gap-2 text-sm leading-tight font-semibold">
                    <TypeChip label={t('binding.type_link')} />
                    <span className="min-w-0 truncate">{item.link.label ?? memberName}</span>
                  </span>
                  <span className="text-muted-foreground break-words">
                    {statusLabel(item.link)}
                    {item.link.assignedRole && (
                      <>
                        {' · '}
                        {t(`members.role.${item.link.assignedRole}` as never)}
                      </>
                    )}
                    {' · '}
                    {t('share.created_at', { date: item.link.createdAt })}
                    {item.link.expiresAt && (
                      <> · {t('share.expires_at', { date: item.link.expiresAt })}</>
                    )}
                  </span>
                </span>
                {!item.link.revoked && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() => revokeLink(item.id)}
                    disabled={pending}
                    aria-label={t('share.revoke')}
                  >
                    <Trash2 className="text-destructive-ink size-3.5" />
                  </Button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
