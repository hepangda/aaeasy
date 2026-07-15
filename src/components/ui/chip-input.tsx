import * as React from 'react';
import { useTranslations } from 'use-intl';
import { AtSign, Check, Loader2, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Plain text chip → a member with that display name. Mention chip → an
 * invitation will be sent to that registered user when the parent form is
 * submitted (if the username resolves).
 */
export type MemberChip = { kind: 'name'; text: string } | { kind: 'mention'; username: string };

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
// Any of these characters inside the buffer flushes the preceding text as a
// chip. ASCII comma + Chinese full-width comma cover desktop typing, mobile
// IME, and paste in both locales.
const DELIMITER_PATTERN = /[,，]/;

/**
 * Chip-style member input. Type a plain word and press Enter — or type a
 * comma (ASCII `,` / full-width `，`) — to add a name chip; start with "@"
 * to add a mention chip (the username is resolved against /api/users/search
 * for a checkmark or warning icon). Pasted text containing any of those
 * delimiters is split into multiple chips at once. Backspace on an empty
 * buffer removes the last chip; each chip has its own × button.
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
  const [resolutions, setResolutions] = React.useState<Record<string, ResolveState>>({});

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
    void (async () => {
      const results = await Promise.all(
        pending.map(async (u): Promise<[string, ResolveState]> => {
          try {
            const res = await fetch(`/api/users/search?q=${encodeURIComponent(u)}`);
            if (!res.ok) {
              return [u, { status: 'unresolved' }];
            }
            const body = (await res.json()) as {
              users: { username: string; displayName: string }[];
            };
            const hit = body.users.find((x) => x.username.toLowerCase() === u);
            return [
              u,
              hit ? { status: 'resolved', displayName: hit.displayName } : { status: 'unresolved' },
            ];
          } catch {
            return [u, { status: 'unresolved' }];
          }
        }),
      );
      if (cancelled) return;
      setResolutions((prev) => ({ ...prev, ...Object.fromEntries(results) }));
    })();
    return () => {
      cancelled = true;
    };
  }, [mentionUsernames, resolutions]);

  function commitBuffer(raw: string): boolean {
    const chip = makeChip(raw.trim(), value);
    if (!chip || value.length >= max) return false;
    onChange([...value, chip]);
    return true;
  }

  /**
   * Commit every delimiter-separated piece in `next` except the trailing one,
   * which stays in the buffer so the user can keep typing. Mutates `value`
   * via onChange and returns the leftover trailing text.
   */
  function commitDelimited(next: string): string {
    if (!DELIMITER_PATTERN.test(next)) return next;
    const parts = next.split(DELIMITER_PATTERN);
    const trailing = parts.pop() ?? '';
    let pool = [...value];
    for (const piece of parts) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      if (pool.length >= max) break;
      const chip = makeChip(trimmed, pool);
      if (chip) pool = [...pool, chip];
    }
    if (pool.length !== value.length) onChange(pool);
    return trailing;
  }

  function makeChip(trimmed: string, pool: MemberChip[]): MemberChip | null {
    if (!trimmed) return null;
    if (trimmed.startsWith('@')) {
      const username = trimmed.slice(1).toLowerCase();
      if (username.length < MENTION_MIN_LEN) return null;
      if (!MENTION_PATTERN.test(username)) return null;
      if (pool.some((c) => c.kind === 'mention' && c.username === username)) return null;
      return { kind: 'mention', username };
    }
    const text = trimmed.slice(0, 40);
    if (
      pool.some((c) => c.kind === 'name' && c.text.toLocaleLowerCase() === text.toLocaleLowerCase())
    ) {
      return null;
    }
    return { kind: 'name', text };
  }

  function removeAt(index: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setBuffer(commitDelimited(e.target.value));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    // 229 / isComposing guards against IME composition firing Enter early.
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (e.key === 'Enter' && !composing) {
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

  const atCap = value.length >= max;

  return (
    <div
      className={cn(
        'border-input bg-card focus-within:border-primary/40 focus-within:ring-ring/25 flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm focus-within:ring-4',
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
          removeLabel={`${t('common.remove')} ${
            chip.kind === 'name' ? chip.text : `@${chip.username}`
          }`}
        />
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={buffer}
        onChange={handleChange}
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
  removeLabel,
}: {
  chip: MemberChip;
  state?: ResolveState;
  onRemove: () => void;
  disabled: boolean;
  unresolvedLabel: string;
  removeLabel: string;
}) {
  const isMention = chip.kind === 'mention';
  const unresolved = isMention && state?.status === 'unresolved';
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-tight',
        isMention
          ? unresolved
            ? 'border-destructive/50 bg-destructive/10 text-destructive-ink'
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
        className="hover:bg-foreground/10 -mr-1 ml-0.5 inline-flex size-7 items-center justify-center rounded-full disabled:cursor-not-allowed"
        aria-label={removeLabel}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
