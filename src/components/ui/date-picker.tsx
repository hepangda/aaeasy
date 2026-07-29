import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useModalLayer } from '@/components/ui/dialog';
import { FloatingPanel } from '@/components/ui/floating-panel';
import { cn } from '@/lib/utils';

export interface DatePickerProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** ISO `yyyy-mm-dd` bounds, inclusive. */
  min?: string;
  max?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Parse `yyyy-mm-dd` as a *local* calendar date — `new Date(iso)` reads UTC. */
function parseISO(iso: string): Date | null {
  if (!ISO.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  // Rejects overflow like 2024-02-31, which the Date constructor silently rolls.
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date
    : null;
}

function toISO(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  // Clamp: Jan 31 + 1 month should land on Feb 28/29, not Mar 2/3.
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), lastDay));
  return next;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A date field that renders its own calendar rather than deferring to the platform.
 *
 * `<input type="date">` hands off to an OS picker — an iOS wheel, a Chrome popup,
 * nothing at all in some Android webviews — none of which respect the app's type
 * scale, dark mode or 44px touch targets, and each of which renders its own inline
 * text differently enough that `globals.css` needed a block of `-webkit-datetime-edit`
 * overrides just to keep the control the same height as its siblings.
 *
 * A real `<input type="date">` stays in the DOM (so `name`, form submission and
 * validation behave), hidden and driven through its native value setter.
 */
export function DatePicker({
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
  required,
  min,
  max,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: DatePickerProps) {
  const t = useTranslations('common');
  const locale = useLocale();
  const nativeRef = React.useRef<HTMLInputElement>(null);

  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? '');
  const current = isControlled ? value : internal;
  const selected = parseISO(current);

  const [open, setOpen] = React.useState(false);
  const [triggerEl, setTriggerEl] = React.useState<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  // Matches Select: a dropdown shouldn't freeze the page, and the lock's own
  // side effect (removing the scrollbar) shifts everything underneath.
  useModalLayer(open, close, panelRef, { lockScroll: false });

  // The keyboard cursor. Distinct from the selection: arrowing around a calendar
  // should preview days without committing them.
  const [cursor, setCursor] = React.useState<Date>(() => selected ?? new Date());
  React.useEffect(() => {
    if (open) setCursor(parseISO(current) ?? new Date());
  }, [open, current]);

  const minDate = min ? parseISO(min) : null;
  const maxDate = max ? parseISO(max) : null;
  const isDisabledDay = React.useCallback(
    (date: Date) => {
      if (minDate && date < minDate) return true;
      if (maxDate && date > maxDate) return true;
      return false;
    },
    [minDate, maxDate],
  );

  const monthLabel = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(cursor),
    [locale, cursor],
  );
  const triggerLabel = React.useMemo(
    () =>
      selected
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(selected)
        : t('date_placeholder'),
    [locale, selected, t],
  );

  // Weekday headers, ordered from the locale's own first day of week.
  const { weekStart, weekdays } = React.useMemo(() => {
    // `getWeekInfo` is not in every engine; Sunday-first is the safe fallback.
    const info = (
      Intl.Locale
        ? (new Intl.Locale(locale) as Intl.Locale & {
            getWeekInfo?: () => { firstDay: number };
            weekInfo?: { firstDay: number };
          })
        : null
    ) as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } } | null;
    let firstDay = 7;
    try {
      firstDay = info?.getWeekInfo?.().firstDay ?? info?.weekInfo?.firstDay ?? 7;
    } catch {
      firstDay = 7;
    }
    // Intl uses 1=Monday…7=Sunday; JS `getDay()` uses 0=Sunday.
    const start = firstDay % 7;
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    // 2024-01-07 was a Sunday, giving a stable reference week.
    const labels = Array.from({ length: 7 }, (_, i) =>
      format.format(new Date(2024, 0, 7 + ((start + i) % 7))),
    );
    return { weekStart: start, weekdays: labels };
  }, [locale]);

  // Six fixed rows: a month-dependent row count would resize the panel as the
  // user pages through it.
  const days = React.useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    const gridStart = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor, weekStart]);

  function commit(date: Date) {
    const iso = toISO(date);
    setOpen(false);
    triggerEl?.focus();
    if (!isControlled) setInternal(iso);
    onValueChange?.(iso);
    const element = nativeRef.current;
    if (!element) return;
    // Native setter + a real event, so anything listening on the input (React
    // onChange, form libraries, validation) sees a genuine change.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, iso);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onPanelKeyDown(event: React.KeyboardEvent) {
    const move = (days: number) => {
      event.preventDefault();
      setCursor((c) => addDays(c, days));
    };
    const shift = (months: number) => {
      event.preventDefault();
      setCursor((c) => addMonths(c, months));
    };
    switch (event.key) {
      case 'ArrowLeft':
        return move(-1);
      case 'ArrowRight':
        return move(1);
      case 'ArrowUp':
        return move(-7);
      case 'ArrowDown':
        return move(7);
      case 'PageUp':
        return shift(-1);
      case 'PageDown':
        return shift(1);
      case 'Home':
        event.preventDefault();
        return setCursor((c) => new Date(c.getFullYear(), c.getMonth(), 1));
      case 'End':
        event.preventDefault();
        return setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 0));
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!isDisabledDay(cursor)) commit(cursor);
        return;
      default:
        return;
    }
  }

  React.useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const today = new Date();
  const gridId = `${id ?? name ?? 'date'}-grid`;

  return (
    <div className="relative">
      {/* The real control stays for form semantics but is never interacted with.
          Deliberately not `required`/`readOnly`: a control that is invisible and
          barred from constraint validation either does nothing or makes the
          browser refuse to submit with an unfocusable-control error. Emptiness
          is validated server-side. */}
      <input
        ref={nativeRef}
        type="date"
        id={id ? `${id}-value` : undefined}
        name={name}
        value={current}
        onChange={() => {}}
        disabled={disabled}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute size-0 opacity-0"
      />

      <button
        ref={setTriggerEl}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required || undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className={cn(
          'border-input bg-card text-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/14 disabled:bg-muted flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm transition-[border-color,box-shadow,background-color] duration-150 focus-visible:ring-3 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55',
          className,
        )}
      >
        <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
          {triggerLabel}
        </span>
        <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </button>

      <FloatingPanel
        open={open}
        anchor={triggerEl}
        onClose={close}
        align="start"
        gap={4}
        role="dialog"
        ariaLabel={ariaLabel ?? t('date_picker')}
        // Sized so the 7 columns are a true 44px wide (7×44 + 6×2 gap + 2×12
        // padding), not just 44px tall. Still fits a 375px viewport.
        className="border-border bg-popover shadow-lifted w-[21.5rem] rounded-xl border p-3 focus:outline-hidden"
        panelRef={panelRef}
        panelProps={{ tabIndex: -1, onKeyDown: onPanelKeyDown }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCursor((c) => addMonths(c, -1))}
            aria-label={t('previous_month')}
            className="hover:bg-accent text-muted-foreground hover:text-foreground flex size-9 items-center justify-center rounded-md"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <div aria-live="polite" className="text-sm font-medium">
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            aria-label={t('next_month')}
            className="hover:bg-accent text-muted-foreground hover:text-foreground flex size-9 items-center justify-center rounded-md"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="text-muted-foreground grid grid-cols-7 text-center text-[0.6875rem]">
          {weekdays.map((label) => (
            <div key={label} className="py-1">
              {label}
            </div>
          ))}
        </div>

        <div role="grid" id={gridId} className="grid grid-cols-7 gap-0.5">
          {days.map((day) => {
            const outside = day.getMonth() !== cursor.getMonth();
            const isSelected = selected ? sameDay(day, selected) : false;
            const isCursor = sameDay(day, cursor);
            const isToday = sameDay(day, today);
            const dayDisabled = isDisabledDay(day);
            return (
              <button
                key={toISO(day)}
                type="button"
                role="gridcell"
                tabIndex={-1}
                disabled={dayDisabled}
                aria-selected={isSelected}
                aria-current={isToday ? 'date' : undefined}
                onPointerDown={(event) => {
                  event.preventDefault();
                  if (!dayDisabled) commit(day);
                }}
                onPointerEnter={() => !dayDisabled && setCursor(day)}
                className={cn(
                  // 44px rows on touch: this grid is the whole target area.
                  'flex h-11 items-center justify-center rounded-md text-sm tabular-nums',
                  outside && 'text-muted-foreground/55',
                  isToday && !isSelected && 'text-primary font-semibold',
                  isCursor && !isSelected && 'bg-accent text-accent-foreground',
                  isSelected && 'bg-primary text-primary-foreground font-semibold',
                  dayDisabled && 'cursor-not-allowed opacity-35',
                )}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex justify-between gap-2">
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              if (!isDisabledDay(today)) commit(today);
            }}
            disabled={isDisabledDay(today)}
            className="text-primary hover:bg-accent min-h-11 rounded-md px-3 text-sm font-medium disabled:opacity-45"
          >
            {t('today')}
          </button>
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              close();
              triggerEl?.focus();
            }}
            className="text-muted-foreground hover:bg-accent hover:text-foreground min-h-11 rounded-md px-3 text-sm"
          >
            {t('close')}
          </button>
        </div>
      </FloatingPanel>
    </div>
  );
}
