import type { FormEvent, ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/**
 * A dialog with the standard header/body/footer rhythm and a Cancel + Submit
 * pair. Replaces 5 hand-rolled `<Dialog>` bodies and 7 copies of the same
 * `flex justify-end gap-2` footer.
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
  submitDisabled,
  pending,
  destructive = false,
  /** Block backdrop/Escape dismissal while the action is in flight. */
  lockWhilePending = true,
  maxWidth = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  onSubmit: () => void;
  submitLabel: ReactNode;
  submitDisabled?: boolean;
  pending?: boolean;
  destructive?: boolean;
  lockWhilePending?: boolean;
  maxWidth?: 'sm' | 'md' | 'lg';
}) {
  const t = useTranslations('common');

  const handleClose = () => {
    if (pending && lockWhilePending) return;
    onClose();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      className={maxWidth === 'sm' ? 'max-w-sm' : maxWidth === 'lg' ? 'max-w-2xl' : 'max-w-md'}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {description && <p className="text-muted-foreground text-sm leading-6">{description}</p>}
        {children}
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant={destructive ? 'destructive' : 'default'}
            disabled={submitDisabled || pending}
          >
            {pending ? t('loading') : submitLabel}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
