import { useCallback, useTransition } from 'react';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/router/navigation';
import { useConfirm, type ConfirmOptions } from '@/components/ui/confirm-dialog';
import { showI18nError, successToast } from '@/lib/ui/toast';

/** The shape every action in this app resolves to. */
export interface ActionResult {
  ok?: boolean;
  error?: string;
}

/**
 * Collapses the 5-step sequence that was hand-written in 18 action components
 * (with `showI18nError(t, res.error ?? 'errors.unknown')` alone appearing 31
 * times):
 *
 *   1. useTransition for pending state
 *   2. optionally confirm first
 *   3. await the action
 *   4. on failure, translate + toast the error key
 *   5. on success, optionally navigate / toast (the action itself has already
 *      invalidated the caches it touched)
 *
 *     const { run, pending } = useAsyncAction({
 *       action: () => deleteGroupAction(groupId),
 *       confirm: { message: t('groups.confirm_delete') },
 *       redirectTo: '/groups',
 *     });
 */
export function useAsyncAction<TArgs extends unknown[] = []>({
  action,
  confirm: confirmOptions,
  onSuccess,
  successMessage,
  redirectTo,
}: {
  action: (...args: TArgs) => Promise<ActionResult>;
  /** When set, a confirm dialog gates the action. Declining is a no-op. */
  confirm?: ConfirmOptions | (() => ConfirmOptions);
  onSuccess?: (result: ActionResult) => void;
  successMessage?: string;
  redirectTo?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    async (...args: TArgs) => {
      if (confirmOptions) {
        const opts = typeof confirmOptions === 'function' ? confirmOptions() : confirmOptions;
        if (!(await confirm(opts))) return;
      }

      startTransition(async () => {
        const res = await action(...args);
        if (!res.ok) {
          showI18nError(t, res.error ?? 'errors.unknown');
          return;
        }
        if (successMessage) successToast(successMessage);
        onSuccess?.(res);
        if (redirectTo) router.push(redirectTo);
      });
    },
    [action, confirm, confirmOptions, onSuccess, redirectTo, router, successMessage, t],
  );

  return { run, pending };
}
