import { useState } from 'react';
import type { LedgerMember } from '@/spa/types';
import { cn } from '@/lib/utils';

/**
 * Avatar background colours. Every entry is checked to clear WCAG AA (4.5:1)
 * against the white initials drawn on top — the previous palette had three
 * failures, the worst being an amber at 2.51:1 that was effectively unreadable.
 */
const FALLBACK_COLORS = ['#2F5FD0', '#1F7A5E', '#8A6410', '#A8434F', '#63489F', '#2C6A88'];

const SIZE_CLASS = {
  sm: 'size-7 text-[10px]',
  md: 'size-9 text-xs',
  lg: 'size-11 text-sm',
  xl: 'size-12 text-base',
} as const;

export type AvatarSize = keyof typeof SIZE_CLASS;

function fallbackColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
}

export function ledgerMemberColor(member: Pick<LedgerMember, 'id' | 'color'>): string {
  return member.color || fallbackColor(member.id);
}

/**
 * The identity plate. A picture — supplied by the login server through the
 * OIDC `picture` claim — is preferred whenever the member is linked to an
 * account; the coloured initial is the fallback. The initial is always drawn
 * underneath rather than swapped out: a remote avatar that 404s, is blocked or
 * merely loads slowly would otherwise leave a hole, and `onError` retires the
 * broken URL for the rest of the render.
 */
export function Avatar({
  seedId,
  displayName,
  color,
  picture,
  size = 'md',
  className,
}: {
  seedId: string;
  displayName: string;
  color?: string | null;
  picture?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = picture && !broken ? picture : null;

  return (
    <span
      aria-hidden
      className={cn(
        'dark:border-background/80 relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border-2 border-white/80 font-mono font-semibold text-white',
        SIZE_CLASS[size],
        className,
      )}
      style={{ backgroundColor: color || fallbackColor(seedId) }}
    >
      {displayName.trim().charAt(0).toLocaleUpperCase() || '?'}
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}

type AvatarMember = Pick<LedgerMember, 'id' | 'displayName' | 'color'> & {
  linkedUserPicture?: string | null;
};

export function LedgerMemberAvatar({
  member,
  size = 'md',
  className,
}: {
  member: AvatarMember;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <Avatar
      seedId={member.id}
      displayName={member.displayName}
      color={member.color}
      picture={member.linkedUserPicture}
      size={size}
      className={className}
    />
  );
}

export function LedgerMemberStack({ members, max = 5 }: { members: AvatarMember[]; max?: number }) {
  const visible = members.slice(0, max);
  const remaining = members.length - visible.length;

  return (
    <div
      className="flex items-center"
      role="img"
      aria-label={members.map((member) => member.displayName).join(', ')}
    >
      {visible.map((member, index) => (
        <LedgerMemberAvatar
          key={member.id}
          member={member}
          size="md"
          className={cn(index > 0 && '-ml-2.5')}
        />
      ))}
      {remaining > 0 ? (
        <span className="bg-muted text-muted-foreground dark:border-background -ml-2.5 inline-grid size-9 place-items-center rounded-full border-2 border-white font-mono text-[10px] font-semibold">
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}
