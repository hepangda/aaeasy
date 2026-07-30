import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AddMemberForm } from '@/components/group/add-member-form';
import { RemoveMemberButton, RemoveMemberMenuItem } from '@/components/group/remove-member-button';
import { UnlinkMemberButton, UnlinkMemberMenuItem } from '@/components/group/unlink-member-button';
import { MemberRenameButton, MemberRenameDialog } from '@/components/group/member-rename-button';
import { MemberRoleControl, MemberRoleMenuSection } from '@/components/group/member-role-control';
import { AccountBindingDialog } from '@/components/share/account-binding-dialog';
import type { ExistingShareLink } from '@/components/share/types';
import type { MemberPendingInvitationRow } from '@/components/share/account-binding-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Pencil, Link as LinkIcon } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Pagination } from '@/components/ui/pagination';
import type { MemberLite } from './types';

export const PAGE_SIZE_MEMBERS = 12;

interface RowProps {
  groupId: string;
  member: MemberLite;
  isOwner: boolean;
  canManage: boolean;
  existingShareLinks: ExistingShareLink[];
  pendingInvitations: MemberPendingInvitationRow[];
  baseUrl: string;
}

function useRowFacts({
  member,
  isOwner,
  canManage,
}: Pick<RowProps, 'member' | 'isOwner' | 'canManage'>) {
  const isLinked = !!member.linkedUserId;
  return {
    isLinked,
    displayName: isLinked
      ? (member.linkedUserDisplayName ?? member.displayName)
      : member.displayName,
    canRename: canManage && !isLinked,
    canBind: canManage && !isLinked && member.linkedUserRole !== 'OWNER',
    canUnlink: isOwner && isLinked && member.linkedUserRole !== 'OWNER',
    canRemove: canManage && !isLinked,
    canSetRole: isLinked && !!member.linkedUserRole && isOwner && member.linkedUserRole !== 'OWNER',
  };
}

function MemberIdentity({
  displayName,
  member,
  isLinked,
}: {
  displayName: string;
  member: MemberLite;
  isLinked: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left">
      <span className="font-semibold">{displayName}</span>
      {member.linkedUsername && (
        <span className="text-muted-foreground text-xs">@{member.linkedUsername}</span>
      )}
      {!isLinked && (
        <span className="text-muted-foreground rounded-md border border-dashed px-2 py-0.5 text-xs">
          {t('members.unlinked_badge')}
        </span>
      )}
    </div>
  );
}

/**
 * Compact row: the row itself is the menu trigger, matching the expense feed.
 * On touch there is no hover to reveal actions and no room to park a strip of
 * icon buttons next to the name.
 */
function CompactMemberRow(props: RowProps) {
  const { groupId, member, isOwner, existingShareLinks, pendingInvitations, baseUrl } = props;
  const t = useTranslations();
  const facts = useRowFacts(props);
  const [renameOpen, setRenameOpen] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);

  return (
    <li>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hover:bg-accent/35 data-[state=open]:bg-accent/60 flex min-h-16 w-full items-center gap-3 px-4 py-2 text-sm transition-colors"
            aria-label={t('common.actions')}
          >
            <MemberIdentity
              displayName={facts.displayName}
              member={member}
              isLinked={facts.isLinked}
            />
            {member.linkedUserRole && (
              <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold">
                {t(`members.role.${member.linkedUserRole}` as never)}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {/* The menu names the member it belongs to: once it floats over the
              list, the highlighted row alone can be hidden behind the panel. */}
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate">{facts.displayName}</span>
            {member.linkedUsername ? (
              <span className="text-muted-foreground text-xs font-normal">
                @{member.linkedUsername}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs font-normal">
                {t('members.unlinked_badge')}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {facts.canSetRole && member.linkedUserRole ? (
            <>
              <MemberRoleMenuSection
                groupId={groupId}
                memberId={member.id}
                currentRole={member.linkedUserRole}
              />
              <DropdownMenuSeparator />
            </>
          ) : null}
          {facts.canRename ? (
            <DropdownMenuItem className="gap-2" onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('members.rename')}
            </DropdownMenuItem>
          ) : null}
          {facts.canBind ? (
            <DropdownMenuItem className="gap-2" onSelect={() => setBindOpen(true)}>
              <LinkIcon className="size-4" aria-hidden="true" />
              {t('binding.button_label')}
            </DropdownMenuItem>
          ) : null}
          {facts.canUnlink ? <UnlinkMemberMenuItem groupId={groupId} memberId={member.id} /> : null}
          {facts.canRemove ? <RemoveMemberMenuItem groupId={groupId} memberId={member.id} /> : null}
          {facts.canSetRole ||
          facts.canRename ||
          facts.canBind ||
          facts.canUnlink ||
          facts.canRemove ? null : (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">{t('common.no_actions')}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs live outside the menu, which unmounts on select. */}
      {facts.canRename ? (
        <MemberRenameDialog
          groupId={groupId}
          memberId={member.id}
          currentName={member.displayName}
          open={renameOpen}
          onOpenChange={setRenameOpen}
        />
      ) : null}
      {facts.canBind ? (
        <AccountBindingDialog
          groupId={groupId}
          memberId={member.id}
          memberName={facts.displayName}
          canAssignManager={isOwner}
          existingLinks={existingShareLinks.filter((l) => l.memberId === member.id)}
          pendingInvitations={pendingInvitations.filter((inv) => inv.memberId === member.id)}
          baseUrl={baseUrl}
          open={bindOpen}
          onOpenChange={setBindOpen}
        />
      ) : null}
    </li>
  );
}

/** Wide row: pointer devices get the actions inline, as before. */
function WideMemberRow(props: RowProps) {
  const { groupId, member, isOwner, existingShareLinks, pendingInvitations, baseUrl } = props;
  const facts = useRowFacts(props);

  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-2 text-sm">
      {/* Identity and controls share one line at every width. Stacking them
          below `sm` doubled the height of rows whose only trailing element is
          a role badge, which fits beside the name with room to spare. */}
      <MemberIdentity displayName={facts.displayName} member={member} isLinked={facts.isLinked} />
      <span className="flex min-h-11 shrink-0 flex-wrap items-center justify-end gap-1">
        {facts.isLinked && member.linkedUserRole && (
          <MemberRoleControl
            groupId={groupId}
            memberId={member.id}
            currentRole={member.linkedUserRole}
            editable={isOwner && member.linkedUserRole !== 'OWNER'}
          />
        )}
        {facts.canRename && (
          <MemberRenameButton
            groupId={groupId}
            memberId={member.id}
            currentName={member.displayName}
          />
        )}
        {facts.canBind && (
          <AccountBindingDialog
            groupId={groupId}
            memberId={member.id}
            memberName={facts.displayName}
            canAssignManager={isOwner}
            existingLinks={existingShareLinks.filter((l) => l.memberId === member.id)}
            pendingInvitations={pendingInvitations.filter((inv) => inv.memberId === member.id)}
            baseUrl={baseUrl}
          />
        )}
        {facts.canUnlink && <UnlinkMemberButton groupId={groupId} memberId={member.id} />}
        {facts.canRemove && <RemoveMemberButton groupId={groupId} memberId={member.id} />}
      </span>
    </li>
  );
}

/**
 * Who is in this ledger, and how each person is linked to an account.
 *
 * Split out of the former "Members & settings" tab: rosters and destructive
 * group operations are different jobs, and bundling them meant a user looking
 * for one had to scan past the other.
 */
export function MembersPanel({
  groupId,
  members,
  membersPage,
  isOwner,
  canManage,
  existingShareLinks,
  pendingInvitations,
  baseUrl,
}: {
  groupId: string;
  members: MemberLite[];
  membersPage: { slice: MemberLite[]; page: number; totalPages: number };
  isOwner: boolean;
  canManage: boolean;
  existingShareLinks: ExistingShareLink[];
  pendingInvitations: MemberPendingInvitationRow[];
  baseUrl: string;
}) {
  const isCompact = useMediaQuery('(max-width: 767px)');

  return (
    <section className="flex flex-col gap-4">
      {canManage && <AddMemberForm groupId={groupId} />}
      <ul className="divide-y rounded-lg border">
        {membersPage.slice.map((member) => {
          const props: RowProps = {
            groupId,
            member,
            isOwner,
            canManage,
            existingShareLinks,
            pendingInvitations,
            baseUrl,
          };
          // Every compact row is tappable, even one the caller cannot manage:
          // a row that ignores taps reads as broken, so those open a menu that
          // identifies the member and says there is nothing to do.
          return isCompact ? (
            <CompactMemberRow key={member.id} {...props} />
          ) : (
            <WideMemberRow key={member.id} {...props} />
          );
        })}
      </ul>
      <Pagination paramKey="mp" totalItems={members.length} pageSize={PAGE_SIZE_MEMBERS} />
    </section>
  );
}
