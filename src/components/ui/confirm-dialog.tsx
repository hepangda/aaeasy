'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Use a destructive (red) confirm button. Defaults to true since most
   *  call sites are deletes / revokes / unbinds. */
  destructive?: boolean;
}

type Resolver = (ok: boolean) => void;

interface ConfirmContextValue {
  /** Open a modal confirm and resolve to true/false. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * App-wide provider for the in-app confirm dialog. Wrap your tree once
 * (we do it in the root layout) and call `useConfirm()` from any client
 * component to get an awaitable `confirm({...})`.
 *
 * This replaces every `window.confirm()` in the app — same Promise-based
 * shape, but rendered with our `Dialog` primitive (proper styling, KbD
 * support, focus trap-ish backdrop, etc.).
 */
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: Resolver;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ opts, resolve });
    });
  }, []);

  const finish = useCallback(
    (ok: boolean) => {
      if (!state) return;
      // Defer resolve so the dialog has a chance to unmount cleanly before
      // the caller re-renders or navigates.
      const r = state.resolve;
      setState(null);
      startTransition(() => {
        r(ok);
      });
    },
    [state],
  );

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => finish(false)}
        title={state?.opts.title}
        className="max-w-sm"
      >
        <p className="text-sm leading-relaxed">{state?.opts.message}</p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => finish(false)}
            disabled={pending}
          >
            {state?.opts.cancelText ?? t('cancel')}
          </Button>
          <Button
            type="button"
            variant={state?.opts.destructive === false ? 'default' : 'destructive'}
            onClick={() => finish(true)}
            disabled={pending}
            autoFocus
          >
            {state?.opts.confirmText ?? t('confirm')}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Get the awaitable `confirm({...})`. Throws if used outside the provider
 * — that should never happen in practice since the provider lives at the
 * root layout.
 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmDialogProvider');
  return ctx.confirm;
}
