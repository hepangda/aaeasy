'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AtSign, Check, Loader2, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Plain text chip → a member with that display name. Mention chip → an
 * invitation will be sent to that registered user when the parent form is
 * submitted (if the username resolves).
 */
export type MemberChip =
  | { kind: 'name'; text: string }
  | { kind: 'mention'; username: string };

type ResolveState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'resolved'; displayName: string }
  | { status: 'unresolved' };

interface ChipInputProps {
  value: MemberChip[];
  onChange: (next: MemberChip[]) => void;
  /** Hard cap on number of chips. Defaults to 50. */
  max?: number;
  /** Forwarded to the underlying <input> for label association. */
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

const MENTION_MIN_LEN = 3;
const MENTION_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const RESOLVE_DEBOUNCE_MS = 250;

/**
 * Chip-style member input. Type a plain word and press Enter / "," to add a
 * name chip; start with "@" to add a mention chip (the username is resolved
 * against /api/users/search for a checkmark or warning icon). Backspace on
 * an empty buffer removes the last chip; each chip has its own × button.
 *
 * The container is a focusable wrapper that auto-grows: the actual <input>
 * uses `flex: 1` and a minimum width so the box wraps to a second row when
 * the user adds enough chips.
 */
export function ChipInput({
  value,
  onChange,
  max = 50,
  id,
  placeholder,
  ariaLabel,
  disabled = false,
}: ChipInputProps) {
  const t = useTranslations();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [buffer, setBuffer] = React.useState('');
  // Resolution cache keyed by lowercased username — survives across renders
  // so we don't refetch every time a mention chip is re-evaluated.
  const [resolutions, setResolutions] = React.useState<
    Record<string, ResolveState>
  >({});

  const mentionUsernames = React.useMemo(
    () =>
      Array.from(
        new Set(
          value
            .filter((c): c is { kind: 'mention'; username: string } => c.kind === 'mention')
            .map((c) => c.username.toLowerCase()),
        ),
      ),
    [value],
  );

  // Resolve any mention chips whose state we don't have yet.
  React.useEffect(() => {
    const pending = mentionUsernames.filter(
      (u) => !resolutions[u] || resolutions[u]?.status === 'idle',
    );
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      // Resolve sequentially; queue is tiny (max 50 chips).
      for (const u of pending) {
        try {
          const res = await fetch(
            `/api/users/search?q=${encodeURIComponent(u)}`,
          );
          if (cancelled) return;
          if (!res.ok) {
            setResolutions((prev) => ({ ...prev, [u]: { status: 'unresolved' } }));
            continue;
          }
          const body = (await res.json()) as {
            users: { username: string; displayName: string }[];
          };
          if (cancelled) return;
          const hit = body.users.find((x) => x.username.toLowerCase() === u);
          setResolutions((prev) => ({
            ...prev,
            [u]: hit
              ? { status: 'resolved', displayName: hit.displayName }
              : { status: 'unresolved' },
          }));
        } catch {
          if (cancelled) return;
          setResolutions((prev) => ({ ...prev, [u]: { status: 'unresolved' } }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mentionUsernames, resolutions]);

  function commitBuffer(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    if (value.length >= max) return false;

    if (trimmed.startsWith('@')) {
      const username = trimmed.slice(1).toLowerCase();
      if (username.length < MENTION_MIN_LEN) return false;
      if (!MENTION_PATTERN.test(username)) return false;
      if (
        value.some((c) => c.kind === 'mention' && c.username === username)
      ) {
        return false;
      }
      onChange([...value, { kind: 'mention', username }]);
      return true;
    }

    const text = trimmed.slice(0, 40);
    if (
      value.some(
        (c) =>
          c.kind === 'name' &&
          c.text.toLocaleLowerCase() === text.toLocaleLowerCase(),
      )
    ) {
      return false;
    }
    onChange([...value, { kind: 'name', text }]);
    return true;
  }

  function removeAt(index: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ',') {
      if (buffer.trim()) {
        e.preventDefault();
        if (commitBuffer(buffer)) setBuffer('');
      }
    } else if (e.key === 'Backspace' && buffer === '' && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  function handleBlur() {
    if (buffer.trim()) {
      if (commitBuffer(buffer)) setBuffer('');
    }
  }

  // Debounced commit-on-pause for mention-style typing so users don't have
  // to press Enter to see the resolution icon while they're still typing.
  React.useEffect(() => {
    if (!buffer.trim().startsWith('@')) return;
    const username = buffer.trim().slice(1).toLowerCase();
    if (username.length < MENTION_MIN_LEN) return;
    if (resolutions[username]) return;
    const handle = setTimeout(() => {
      // Pre-warm the resolver cache without committing a chip yet.
      setResolutions((prev) =>
        prev[username] ? prev : { ...prev, [username]: { status: 'idle' } },
      );
    }, RESOLVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [buffer, resolutions]);

  const atCap = value.length >= max;

  return (
    <div
      className={cn(
        'border-input bg-background ring-offset-background focus-within:ring-ring flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-offset-2',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((chip, i) => (
        <ChipPill
          key={`${chip.kind}-${chip.kind === 'name' ? chip.text : chip.username}-${i}`}
          chip={chip}
          state={
            chip.kind === 'mention'
              ? (resolutions[chip.username.toLowerCase()] ?? { status: 'loading' })
              : undefined
          }
          onRemove={() => removeAt(i)}
          disabled={disabled}
          unresolvedLabel={t('groups.chip_unresolved_mention')}
        />
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : undefined}
        aria-label={ariaLabel}
        disabled={disabled || atCap}
        autoComplete="off"
        className="placeholder:text-muted-foreground min-w-[10ch] flex-1 bg-transparent px-1 py-1 text-sm outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

function ChipPill({
  chip,
  state,
  onRemove,
  disabled,
  unresolvedLabel,
}: {
  chip: MemberChip;
  state?: ResolveState;
  onRemove: () => void;
  disabled: boolean;
  unresolvedLabel: string;
}) {
  const isMention = chip.kind === 'mention';
  const unresolved = isMention && state?.status === 'unresolved';
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-tight',
        isMention
          ? unresolved
            ? 'border-destructive/50 bg-destructive/10 text-destructive'
            : 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-input bg-muted/60',
      )}
      title={unresolved ? unresolvedLabel : undefined}
    >
      {isMention ? (
        unresolved ? (
          <AlertCircle className="size-3" />
        ) : state?.status === 'loading' ? (
          <Loader2 className="size-3 animate-spin" />
        ) : state?.status === 'resolved' ? (
          <Check className="size-3" />
        ) : (
          <AtSign className="size-3" />
        )
      ) : null}
      <span className="truncate">
        {chip.kind === 'name'
          ? chip.text
          : state?.status === 'resolved'
            ? `${state.displayName} (@${chip.username})`
            : `@${chip.username}`}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        disabled={disabled}
        className="hover:bg-foreground/10 -mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-full disabled:cursor-not-allowed"
        aria-label="Remove"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
