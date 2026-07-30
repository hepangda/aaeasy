import type { FormEvent, ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/**
 * A dialog with the standard header/body/footer rhythm and a Cancel + Submit
 * pair, plus the dismissal guard a submitting form needs.
 *
 * `useConfirm()` remains the right tool for a plain yes/no. Reach for
 * `FormDialog` when the body needs real content — a select, a text input, a
 * type-to-confirm phrase.
 */
export function FormDialog({
  open,
  onClose,
  title,
  description,
  children,
  onSubmit,
  submitLabel,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  onSubmit: () => void;
  submitLabel: ReactNode;
  pending?: boolean;
}) {
  const t = useTranslations('common');

  // Dismissing mid-flight would strand the user with no feedback on an action
  // that is still going to land, so the backdrop and Escape are inert then.
  const handleClose = () => {
    if (pending) return;
    onClose();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Dialog open={open} onClose={handleClose} title={title} className="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {description && <p className="text-muted-foreground text-sm leading-6">{description}</p>}
        {children}
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('loading') : submitLabel}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
