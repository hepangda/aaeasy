import type { LedgerMember } from '@/spa/types';
import { cn } from '@/lib/utils';

const FALLBACK_COLORS = ['#356AE6', '#2F8F72', '#D19A2A', '#B85864', '#7257B8', '#3B7E9F'];

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

export function LedgerMemberAvatar({
  member,
  size = 'md',
  className,
}: {
  member: Pick<LedgerMember, 'id' | 'displayName' | 'color'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'dark:border-background/80 inline-grid shrink-0 place-items-center rounded-full border-2 border-white/80 font-mono font-semibold text-white',
        size === 'sm' && 'size-7 text-[10px]',
        size === 'md' && 'size-9 text-xs',
        size === 'lg' && 'size-11 text-sm',
        className,
      )}
      style={{ backgroundColor: ledgerMemberColor(member) }}
    >
      {member.displayName.trim().charAt(0).toLocaleUpperCase() || '?'}
    </span>
  );
}

export function LedgerMemberStack({
  members,
  max = 5,
}: {
  members: Array<Pick<LedgerMember, 'id' | 'displayName' | 'color'>>;
  max?: number;
}) {
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
