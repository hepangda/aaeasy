import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import {
  AtSign,
  ChevronDown,
  Copy,
  Link as LinkIcon,
  Loader2,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type { GroupRole } from '@aaeasy/contracts';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { createMemberShareLinkAction, revokeShareLinkAction } from '@/spa/actions/shares';
import {
  inviteUserToMemberAction,
  cancelInvitationAction,
  type InvitationRole,
} from '@/spa/actions/invitations';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { showI18nError, successToast } from '@/lib/ui/toast';
import type { ExistingShareLink } from './types';

export interface MemberPendingInvitationRow {
  id: string;
  memberId: string;
  assignedRole: GroupRole;
  createdAt: string | Date;
  invitedUser: { id: string; displayName: string; username: string | null };
  invitedBy: { id: string; displayName: string } | null;
}

const EXPIRES_OPTIONS = [
  { value: '24', i18n: 'share.expires_24h' as const },
  { value: '48', i18n: 'share.expires_48h' as const },
  { value: '72', i18n: 'share.expires_72h' as const },
  { value: 'READ_ONLY', i18n: 'share.expires_read_only' as const },
] as const;

// Account-binding excludes OWNER (separate transfer flow). VIEWER is
// included: a read-only auditor account can be bound either via @-invite or
// via share link, with the same UI control deciding which role the link
// grants on claim.
const ROLE_OPTIONS: InvitationRole[] = ['MANAGER', 'MEMBER', 'VIEWER'];

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

/**
 * Per-member "account binding" dialog. Single page with:
 *   1. A shared "role after binding" picker at the top (used by both
 *      flows below — invite and share-link grant the same role).
 *   2. Two side-by-side sections: invite by @username, generate share link.
 *   3. One merged "sent" list combining pending invitations and existing
 *      share links so a manager can cancel/revoke either from one place.
 *
 * Hidden entirely by the caller when the member is already linked.
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
  const [role, setRole] = useState<InvitationRole>('MEMBER');
  const [tab, setTab] = useState<'bind' | 'sent'>('bind');
  const [method, setMethod] = useState<'invite' | 'link'>('invite');

  const activeLinks = existingLinks.filter((l) => !l.expired && !l.revoked);
  const sentCount = activeLinks.length + pendingInvitations.length;

  const onChanged = () => router.refresh();

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
        {sentCount > 0 && <span className="ml-1 text-xs">{sentCount}</span>}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('binding.dialog_title_for', { name: memberName })}
        className="max-w-lg"
      >
        <div className="flex flex-col gap-4">
          <div role="tablist" className="border-border/60 -mx-1 flex gap-1 border-b">
            <SectionTab
              active={tab === 'bind'}
              onClick={() => setTab('bind')}
              label={t('binding.tab_bind')}
            />
            <SectionTab
              active={tab === 'sent'}
              onClick={() => setTab('sent')}
              label={t('binding.tab_sent')}
              badge={sentCount > 0 ? sentCount : undefined}
            />
          </div>

          {/* Both panels share one grid cell so the container's height is the
              max of either panel's natural height — switching tabs never
              causes a jump on mobile. The inactive panel is invisible but
              still takes layout space. min-w-0 on the grid item prevents
              long descendants (e.g. role labels) from forcing the grid
              wider than the dialog. */}
          <div className="grid min-w-0">
            <div
              role="tabpanel"
              aria-labelledby="bind-tab"
              className={cn(
                'col-start-1 row-start-1 flex min-w-0 flex-col gap-4',
                tab === 'bind' ? 'visible' : 'pointer-events-none invisible',
              )}
            >
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t('binding.assigned_role')}</Label>
                <RoleSegmented
                  value={role}
                  onChange={setRole}
                  canAssignManager={canAssignManager}
                />
              </div>

              <div className="flex flex-col gap-2">
                <MethodCard
                  open={method === 'invite'}
                  onOpen={() => setMethod('invite')}
                  icon={<AtSign className="size-3.5" />}
                  title={t('binding.method_invite')}
                  desc={t('binding.method_invite_desc')}
                >
                  <InviteSection
                    groupId={groupId}
                    memberId={memberId}
                    role={role}
                    onChanged={onChanged}
                  />
                </MethodCard>
                <MethodCard
                  open={method === 'link'}
                  onOpen={() => setMethod('link')}
                  icon={<LinkIcon className="size-3.5" />}
                  title={t('binding.method_link')}
                  desc={t('binding.method_link_desc')}
                >
                  <ShareLinkSection
                    groupId={groupId}
                    memberId={memberId}
                    role={role}
                    onChanged={onChanged}
                    baseUrl={baseUrl}
                  />
                </MethodCard>
              </div>
            </div>

            <div
              role="tabpanel"
              aria-labelledby="sent-tab"
              className={cn(
                'col-start-1 row-start-1 min-w-0',
                tab === 'sent' ? 'visible' : 'pointer-events-none invisible',
              )}
            >
              <SentList
                memberName={memberName}
                existingLinks={existingLinks}
                pendingInvitations={pendingInvitations}
                groupId={groupId}
                onChanged={onChanged}
                confirmDialog={confirmDialog}
              />
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function SectionTab({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      {typeof badge === 'number' && (
        <span className="bg-muted text-muted-foreground inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums">
          {badge}
        </span>
      )}
      {active && (
        <span aria-hidden className="bg-foreground absolute -bottom-px left-0 h-0.5 w-full" />
      )}
    </button>
  );
}

function MethodCard({
  open,
  onOpen,
  icon,
  title,
  desc,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
          open ? 'bg-secondary/40' : 'hover:bg-secondary/20',
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            {icon}
            {title}
          </span>
          {!open && <span className="text-muted-foreground truncate text-xs">{desc}</span>}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
          <p className="text-muted-foreground text-xs">{desc}</p>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Invite section ──────────────────────────────────────────────────────

function InviteSection({
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
    showSuggestions && username.trim().replace(/^@/, '').length >= 3 && suggestions.length > 0;

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
            <Loader2 className="text-muted-foreground absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin" />
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
                    <AtSign className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate font-medium">{s.username}</span>
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

function ShareLinkSection({
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
    const fd = new FormData();
    fd.set('groupId', groupId);
    fd.set('memberId', memberId);
    fd.set('expires', expires);
    fd.set('assignedRole', role);
    if (label.trim()) fd.set('label', label.trim());
    startTransition(async () => {
      const res = await createMemberShareLinkAction({ ok: false }, fd);
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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

function SentList({
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
                  <span className="text-foreground flex min-w-0 items-center gap-2 text-sm leading-tight font-medium">
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
                  <X className="text-destructive size-3.5" />
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
                  <span className="text-foreground flex min-w-0 items-center gap-2 text-sm leading-tight font-medium">
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
                    <Trash2 className="text-destructive size-3.5" />
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

function TypeChip({ label }: { label: string }) {
  return (
    <span className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[10px] font-normal tracking-wide uppercase">
      {label}
    </span>
  );
}

// ─── Role segmented control ──────────────────────────────────────────────

/**
 * Segmented control over MANAGER / MEMBER / VIEWER. MANAGER is hidden
 * unless the caller is OWNER (mirrors the server-side guard).
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
      className="border-input bg-background flex h-10 w-full rounded-md border p-0.5"
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
              'min-w-0 flex-1 truncate rounded px-3 text-sm font-medium transition-colors',
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
