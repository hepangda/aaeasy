import { useEffect, useRef, useState } from 'react';
import { StickyNote, X } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_LENGTH = 200;
/** Only surface the counter once the user is close enough to the ceiling for it
 *  to be actionable. A counter that is always visible reads as a quota. */
const COUNTER_THRESHOLD = 160;

interface Props {
  name?: string;
  defaultValue?: string;
  className?: string;
}

/**
 * The note on an expense is optional and, by design, a single line — the ledger
 * never renders its body, only a `StickyNote` marker and a tooltip. A permanent
 * 96px-tall textarea sitting directly above Save contradicted both facts: it
 * gave an optional field the visual weight of a required one and its size
 * promised room for prose nobody will ever read back.
 *
 * So it starts as a quiet text button and only becomes an input once asked for.
 * The field is uncontrolled and renders a real `textarea[name]`, so the form
 * action keeps reading it straight off `FormData`.
 */
export function OptionalNote({ name = 'note', defaultValue = '', className }: Props) {
  const t = useTranslations();
  const initial = defaultValue.trim();
  // An existing note is shown expanded: making the user click to see what they
  // already wrote would be a step backwards from the old always-open field.
  const [open, setOpen] = useState(initial.length > 0);
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const justOpened = useRef(false);

  useEffect(() => {
    if (justOpened.current && ref.current) {
      justOpened.current = false;
      ref.current.focus();
    }
  }, [open]);

  function close() {
    setValue('');
    setOpen(false);
  }

  if (!open) {
    return (
      <div className={cn('mx-5 mb-5 sm:mx-8 sm:mb-7', className)}>
        {/* The empty value still has to reach the server as an empty string so
            an edit that clears the note actually clears it. */}
        <input type="hidden" name={name} value="" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // The negative margin must cancel the button's own `px-3`, or the
          // hover surface hangs off the field column by the difference.
          className="text-muted-foreground hover:text-foreground -ml-3 font-normal"
          onClick={() => {
            justOpened.current = true;
            setOpen(true);
          }}
        >
          <StickyNote aria-hidden="true" />
          {t('expenses.note_add')}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('mx-5 mb-5 grid gap-2 sm:mx-8 sm:mb-7', className)}>
      <div className="flex items-start gap-2">
        {/* `field-sizing-content` grows the box with the text, so the control is
            one line tall until it genuinely needs more — the size itself is the
            hint about how much to write. `max-h-24` caps it at roughly three
            lines and scrolls beyond that. */}
        <textarea
          ref={ref}
          id={name}
          name={name}
          rows={1}
          maxLength={MAX_LENGTH}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (value.trim() === '') close();
          }}
          aria-label={t('expenses.note')}
          placeholder={t('expenses.note_placeholder')}
          className="border-input bg-card text-foreground placeholder:text-muted-foreground/75 hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/14 field-sizing-content max-h-24 min-h-0 w-full resize-none rounded-md border px-3 py-2 text-sm leading-relaxed transition-[border-color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:outline-hidden"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label={t('expenses.note_remove')}
          // `onMouseDown` rather than `onClick`: the textarea's blur handler
          // fires first and would unmount this button before the click lands.
          onMouseDown={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {value.length >= COUNTER_THRESHOLD && (
        <p className="text-muted-foreground text-right text-xs tabular-nums">
          {value.length}/{MAX_LENGTH}
        </p>
      )}
    </div>
  );
}
