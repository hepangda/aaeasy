import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useModalLayer } from '@/components/ui/dialog';
import { FloatingPanel } from '@/components/ui/floating-panel';
import { cn } from '@/lib/utils';

export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'>;

interface OptionData {
  value: string;
  label: string;
  disabled: boolean;
}

/**
 * A select that renders its own listbox rather than deferring to the platform.
 *
 * Native `<select>` on mobile hands off to an OS picker — a full-screen wheel on
 * iOS, a bare dialog on Android — which ignores the app's type, spacing and dark
 * mode, and gives no room for the 44px touch targets used everywhere else. This
 * keeps a real `<select>` in the DOM (so form submission, `name`, and autofill
 * behave) but hides it and drives it from a styled listbox.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      children,
      value,
      defaultValue,
      onChange,
      disabled,
      name,
      id,
      required,
      'aria-label': ariaLabel,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
    },
    forwardedRef,
  ) => {
    const nativeRef = React.useRef<HTMLSelectElement>(null);
    const [options, setOptions] = React.useState<OptionData[]>([]);
    React.useImperativeHandle(forwardedRef, () => nativeRef.current as HTMLSelectElement);

    const isControlled = value !== undefined;
    const [internal, setInternal] = React.useState(() =>
      String(defaultValue ?? options[0]?.value ?? ''),
    );
    const current = isControlled ? String(value) : internal;
    const selected = options.find((option) => option.value === current);

    // Read the options off the real element rather than inspecting `children`.
    // Call sites pass them as components, fragments and `.map()` output, none of
    // which a structural walk of the React tree reliably sees through.
    React.useLayoutEffect(() => {
      const element = nativeRef.current;
      if (!element) return;
      setOptions(
        Array.from(element.options).map((option) => ({
          value: option.value,
          label: option.textContent ?? '',
          disabled: option.disabled,
        })),
      );
    }, [children]);

    const [open, setOpen] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(0);
    // State, not a ref: the panel needs a re-render once the anchor exists.
    const [triggerEl, setTriggerEl] = React.useState<HTMLButtonElement | null>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    const close = React.useCallback(() => setOpen(false), []);
    // A dropdown shouldn't freeze the page — and the lock's own side effect
    // (removing the scrollbar) shifts everything underneath. The floating panel
    // repositions itself on scroll instead.
    useModalLayer(open, close, listRef, { lockScroll: false });

    // Drive the hidden <select> through its native setter and dispatch a real
    // change event, so React's own onChange fires with a genuine event object
    // rather than a hand-assembled stand-in.
    function commit(next: string) {
      setOpen(false);
      const element = nativeRef.current;
      if (!element) {
        if (!isControlled) setInternal(next);
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(element, next);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    React.useEffect(() => {
      if (!open) return;
      const index = options.findIndex((option) => option.value === current);
      setActiveIndex(index < 0 ? 0 : index);
      // Move focus into the list so arrow keys and Escape work immediately.
      listRef.current?.focus();
    }, [open, options, current]);

    function onTriggerKeyDown(event: React.KeyboardEvent) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
    }

    function onListKeyDown(event: React.KeyboardEvent) {
      const step = (delta: number) => {
        event.preventDefault();
        setActiveIndex((index) => {
          let next = index;
          for (let i = 0; i < options.length; i++) {
            next = (next + delta + options.length) % options.length;
            if (!options[next]!.disabled) break;
          }
          return next;
        });
      };
      if (event.key === 'ArrowDown') step(1);
      else if (event.key === 'ArrowUp') step(-1);
      else if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setActiveIndex(options.length - 1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const option = options[activeIndex];
        if (option && !option.disabled) commit(option.value);
      }
    }

    return (
      <div className="relative">
        {/* The real control stays in the DOM for form semantics, but is never
            what the user interacts with. */}
        <select
          ref={nativeRef}
          name={name}
          id={id}
          value={current}
          onChange={(event) => {
            if (!isControlled) setInternal(event.target.value);
            onChange?.(event);
          }}
          disabled={disabled}
          required={required}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute size-0 opacity-0"
        >
          {children}
        </select>

        <button
          ref={setTriggerEl}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          className={cn(
            'border-input bg-card text-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/14 disabled:bg-muted flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm transition-[border-color,box-shadow,background-color] duration-150 focus-visible:ring-3 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55',
            className,
          )}
        >
          <span className="min-w-0 truncate">{selected?.label ?? ''}</span>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>

        <FloatingPanel
          open={open}
          anchor={triggerEl}
          onClose={close}
          align="start"
          gap={4}
          role="listbox"
          ariaLabel={ariaLabel ?? ''}
          matchAnchorWidth
          className="border-border bg-popover shadow-lifted max-h-64 min-w-40 overflow-y-auto rounded-xl border p-1 focus:outline-hidden"
          panelRef={listRef}
          panelProps={{
            tabIndex: -1,
            onKeyDown: onListKeyDown,
            'aria-activedescendant': `${id ?? name ?? 'select'}-option-${activeIndex}`,
          }}
        >
          {options.map((option, index) => {
            const isSelected = option.value === current;
            return (
              <div
                key={option.value}
                id={`${id ?? name ?? 'select'}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onPointerDown={(event) => {
                  event.preventDefault();
                  if (!option.disabled) commit(option.value);
                }}
                onPointerEnter={() => setActiveIndex(index)}
                className={cn(
                  // 44px rows: this list is the touch target on mobile.
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm',
                  option.disabled && 'pointer-events-none opacity-45',
                  index === activeIndex && 'bg-accent text-accent-foreground',
                )}
              >
                <Check
                  className={cn('size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </div>
            );
          })}
        </FloatingPanel>
      </div>
    );
  },
);
Select.displayName = 'Select';

export { Select };
