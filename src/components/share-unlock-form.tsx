'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { unlockShareAction, type UnlockState } from '@/lib/groups/share-unlock-action';
import { showI18nError } from '@/lib/ui/toast';

const initial: UnlockState = { ok: false };

/**
 * Two states this form may render:
 *   1. Continue button (the default — links never have passwords now)
 *   2. Claim panel — "你是 X 吗?" — shown after the action returns
 *      `needsClaim`. On Yes we re-submit with `claimMemberId` set.
 */
export function ShareUnlockForm({ token }: { token: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(unlockShareAction, initial);
  const claim = state.needsClaim;

  useEffect(() => {
    if (state.error) showI18nError(t, state.error);
  }, [state.error, t]);

  if (claim) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-5 text-center">
        <p className="text-base">{t('share.claim_prompt', { name: claim.memberName })}</p>
        <div className="flex justify-center gap-2">
          <form action={action}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="claimMemberId" value={claim.memberId} />
            <Button type="submit" disabled={pending}>
              {pending ? t('share.continue') : t('share.claim_yes')}
            </Button>
          </form>
          <Button asChild type="button" variant="ghost">
            <a href="/">{t('share.claim_no')}</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending}>
        {t('share.continue')}
      </Button>
    </form>
  );
}
