import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'use-intl';
import { Select } from '@/components/ui/select';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { setMemberRoleAction } from '@/spa/actions/groups';
import { showI18nError } from '@/lib/ui/toast';

type Role = 'OWNER' | 'MANAGER' | 'MEMBER' | 'VIEWER';
type EditableRole = Exclude<Role, 'OWNER'>;

const EDITABLE_ROLES: EditableRole[] = ['MANAGER', 'MEMBER', 'VIEWER'];

/** Optimistic role state shared by the inline select and the menu variant. */
function useRoleSetter(groupId: string, memberId: string, currentRole: Role) {
  const t = useTranslations();
  const [role, setRole] = useState<Role>(currentRole);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRole(currentRole);
  }, [currentRole]);

  function change(next: EditableRole) {
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
    });
  }

  return { role, pending, change };
}

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
  const t = useTranslations();
  const { role, pending, change } = useRoleSetter(groupId, memberId, currentRole);

  // OWNER badge or non-editable: render label only.
  if (!editable || currentRole === 'OWNER') {
    return (
      <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs font-semibold">
        {t(`members.role.${currentRole}` as never)}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Select
        aria-label={t('members.role_label')}
        value={role}
        disabled={pending}
        onChange={(e) => change(e.target.value as EditableRole)}
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

/** Same control as a labelled radio group inside an overflow menu. */
export function MemberRoleMenuSection({
  groupId,
  memberId,
  currentRole,
}: {
  groupId: string;
  memberId: string;
  currentRole: Role;
}) {
  const t = useTranslations();
  const { role, pending, change } = useRoleSetter(groupId, memberId, currentRole);

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
        {t('members.role_label')}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={role} onValueChange={(next) => change(next as EditableRole)}>
        {EDITABLE_ROLES.map((r) => (
          <DropdownMenuRadioItem key={r} value={r} disabled={pending}>
            {t(`members.role.${r}` as never)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}
