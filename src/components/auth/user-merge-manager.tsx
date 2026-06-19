'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { mergeUsersAction, type AdminActionState } from '@/lib/admin/actions';
import { showI18nError, successToast } from '@/lib/ui/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

type MergeUser = {
  id: string;
  displayName: string;
  username: string | null;
  isSuperAdmin: boolean;
  groupCount: number;
  loginCount: number;
};

const initialState: AdminActionState = { ok: false };

export function UserMergeManager({
  users,
  currentUserId,
}: {
  users: MergeUser[];
  currentUserId: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(mergeUsersAction, initialState);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    if (state.ok) {
      successToast(t('admin.merge_success'));
      // Clear the pickers after a successful merge.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSourceId('');
      setTargetId('');
    } else if (state.error) {
      showI18nError(t, state.error);
    }
  }, [state, t]);

  const byId = (id: string) => users.find((u) => u.id === id);
  const source = byId(sourceId);
  const target = byId(targetId);
  const sameUser = sourceId !== '' && sourceId === targetId;
  const sourceIsAdmin = source?.isSuperAdmin ?? false;
  const sourceIsSelf = sourceId === currentUserId;
  const canSubmit =
    sourceId !== '' && targetId !== '' && !sameUser && !sourceIsAdmin && !sourceIsSelf;

  const label = (u: MergeUser) =>
    `${u.displayName}${u.username ? ` (@${u.username})` : ''} · ` +
    t('admin.merge_user_meta', { groups: u.groupCount, logins: u.loginCount });

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(t('admin.merge_confirm'))) e.preventDefault();
      }}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="sourceUserId" value={sourceId} />
      <input type="hidden" name="targetUserId" value={targetId} />

      <div className="grid gap-2">
        <Label htmlFor="merge-source">{t('admin.merge_source_label')}</Label>
        <Select id="merge-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">{t('admin.merge_select_placeholder')}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {label(u)}
            </option>
          ))}
        </Select>
        <p className="text-muted-foreground text-xs">{t('admin.merge_source_hint')}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="merge-target">{t('admin.merge_target_label')}</Label>
        <Select id="merge-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">{t('admin.merge_select_placeholder')}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {label(u)}
            </option>
          ))}
        </Select>
        <p className="text-muted-foreground text-xs">{t('admin.merge_target_hint')}</p>
      </div>

      {sameUser && (
        <p className="text-destructive text-sm">{t('admin.merge_same_user_error')}</p>
      )}
      {sourceIsSelf && (
        <p className="text-destructive text-sm">{t('admin.merge_source_is_self_error')}</p>
      )}
      {sourceIsAdmin && !sourceIsSelf && (
        <p className="text-destructive text-sm">{t('admin.merge_source_is_admin_error')}</p>
      )}

      {source && target && canSubmit && (
        <p className="bg-muted/40 rounded-md border px-4 py-3 text-sm">
          {t.rich('admin.merge_preview', {
            source: source.displayName,
            target: target.displayName,
            strong: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
      )}

      <Button type="submit" variant="destructive" disabled={!canSubmit || pending} className="w-fit">
        {pending ? t('admin.merge_pending') : t('admin.merge_button')}
      </Button>
    </form>
  );
}
