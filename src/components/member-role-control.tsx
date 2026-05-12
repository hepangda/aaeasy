'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/select';
import { setMemberRoleAction } from '@/lib/groups/actions';
import { showI18nError } from '@/lib/ui/toast';

type Role = 'OWNER' | 'MANAGER' | 'MEMBER' | 'VIEWER';
type EditableRole = Exclude<Role, 'OWNER'>;

const EDITABLE_ROLES: EditableRole[] = ['MANAGER', 'MEMBER', 'VIEWER'];

/**
 * Inline role selector for a linked member. Renders a static role label
 * when read-only (caller can't manage members, or target is OWNER), and
 * a `<select>` otherwise. OWNER role transfer is handled separately by
 * the dedicated transfer-ownership flow.
 */
export function MemberRoleControl({
  groupId,
  memberId,
  currentRole,
  editable,
}: {
  groupId: string;
  memberId: string;
  currentRole: Role;
  editable: boolean;
}) {
  const router = useRouter();
  const t = useTranslations();
  const [role, setRole] = useState<Role>(currentRole);
  const [pending, startTransition] = useTransition();

  // OWNER badge or non-editable: render label only.
  if (!editable || currentRole === 'OWNER') {
    return (
      <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs font-medium">
        {t(`members.role.${currentRole}` as never)}
      </span>
    );
  }

  function onChange(next: EditableRole) {
    if (next === role) return;
    const previous = role;
    setRole(next);
    startTransition(async () => {
      const res = await setMemberRoleAction({ groupId, memberId, role: next });
      if (!res.ok) {
        setRole(previous);
        showI18nError(t, res.error ?? 'errors.unknown');
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-1">
      <Select
        aria-label={t('members.role_label')}
        value={role}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as EditableRole)}
        className="h-9 px-2 py-0 text-xs"
      >
        {EDITABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`members.role.${r}` as never)}
          </option>
        ))}
      </Select>
    </span>
  );
}
