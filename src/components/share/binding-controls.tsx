import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils';
import type { InvitationRole } from '@/spa/actions/invitations';

const ROLE_OPTIONS: InvitationRole[] = ['MANAGER', 'MEMBER', 'VIEWER'];

export function SectionTab({
  id,
  controls,
  active,
  onClick,
  label,
  badge,
}: {
  id: string;
  controls: string;
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      {typeof badge === 'number' && (
        <span className="bg-muted text-muted-foreground inline-flex min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] tabular-nums">
          {badge}
        </span>
      )}
      {active && (
        <span aria-hidden className="bg-foreground absolute -bottom-px left-0 h-0.5 w-full" />
      )}
    </button>
  );
}

export function MethodCard({
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
    <div className="overflow-hidden rounded-xl border">
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
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
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
      <div hidden={!open} className="flex flex-col gap-3 px-3 pt-1 pb-3">
        <p className="text-muted-foreground text-xs">{desc}</p>
        {children}
      </div>
    </div>
  );
}

// ─── Invite section ──────────────────────────────────────────────────────

export function TypeChip({ label }: { label: string }) {
  return (
    <span className="bg-secondary text-secondary-foreground rounded-md px-1.5 py-0.5 text-[10px] font-normal tracking-wide uppercase">
      {label}
    </span>
  );
}

// ─── Role segmented control ──────────────────────────────────────────────

/**
 * Segmented control over MANAGER / MEMBER / VIEWER. MANAGER is hidden
 * unless the caller is OWNER (mirrors the server-side guard).
 */
export function RoleSegmented({
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
      aria-label={t('binding.assigned_role')}
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
              'min-w-0 flex-1 truncate rounded-md px-3 text-sm font-semibold transition-colors',
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
