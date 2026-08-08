import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AtSign, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { InviteSection, SentList, ShareLinkSection } from './binding-sections';
import { MethodCard, RoleSegmented, SectionTab } from './binding-controls';
import type { ExistingShareLink, MemberPendingInvitationRow } from './types';
import type { InvitationRole } from '@/spa/actions/invitations';

export type { MemberPendingInvitationRow };

/**
 * Per-member "account binding" dialog. Single page with:
 *   1. A shared "role after binding" picker at the top (used by both
 *      flows below — invite and share-link grant the same role).
 *   2. Two side-by-side sections: invite by @username, generate share link.
 *   3. One merged "sent" list combining pending invitations and existing
 *      share links so a manager can cancel/revoke either from one place.
 *
 * Hidden entirely by the caller when the member is already linked.
 */
export function AccountBindingDialog({
  groupId,
  memberId,
  memberName,
  canAssignManager,
  existingLinks,
  pendingInvitations,
  baseUrl,
  open: controlledOpen,
  onOpenChange,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  canAssignManager: boolean;
  existingLinks: ExistingShareLink[];
  pendingInvitations: MemberPendingInvitationRow[];
  baseUrl: string;
  /**
   * Supply `open`/`onOpenChange` to drive the dialog from elsewhere (e.g. an
   * overflow menu item, which unmounts as soon as it is selected). The
   * built-in trigger button is then omitted.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations();
  const confirmDialog = useConfirm();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setUncontrolledOpen;
  const [role, setRole] = useState<InvitationRole>('MEMBER');
  const [tab, setTab] = useState<'bind' | 'sent'>('bind');
  const [method, setMethod] = useState<'invite' | 'link'>('invite');

  const activeLinks = existingLinks.filter((l) => !l.expired && !l.revoked);
  const sentCount = activeLinks.length + pendingInvitations.length;

  // Each mutation invalidates the caches it touched, so the dialog no longer
  // has to ask the whole app to refetch when something in it changes.
  const onChanged = () => {};

  return (
    <>
      {controlled ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={t('binding.button_label')}
          title={t('binding.button_label')}
        >
          <LinkIcon />
          {sentCount > 0 && <span className="ml-1 text-xs">{sentCount}</span>}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('binding.dialog_title_for', { name: memberName })}
        className="max-w-lg"
      >
        <div className="flex flex-col gap-4">
          <div role="tablist" className="border-border/60 -mx-1 flex gap-1 border-b">
            <SectionTab
              id={`bind-tab-${memberId}`}
              controls={`bind-panel-${memberId}`}
              active={tab === 'bind'}
              onClick={() => setTab('bind')}
              label={t('binding.tab_bind')}
            />
            <SectionTab
              id={`sent-tab-${memberId}`}
              controls={`sent-panel-${memberId}`}
              active={tab === 'sent'}
              onClick={() => setTab('sent')}
              label={t('binding.tab_sent')}
              badge={sentCount > 0 ? sentCount : undefined}
            />
          </div>

          {/* Both panels share one grid cell so the container's height is the
              max of either panel's natural height — switching tabs never
              causes a jump on mobile. The inactive panel is invisible but
              still takes layout space. min-w-0 on the grid item prevents
              long descendants (e.g. role labels) from forcing the grid
              wider than the dialog. */}
          <div className="grid min-w-0">
            <div
              id={`bind-panel-${memberId}`}
              role="tabpanel"
              aria-labelledby={`bind-tab-${memberId}`}
              aria-hidden={tab !== 'bind'}
              className={cn(
                'col-start-1 row-start-1 flex min-w-0 flex-col gap-4',
                tab === 'bind' ? 'visible' : 'pointer-events-none invisible',
              )}
            >
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t('binding.assigned_role')}</Label>
                <RoleSegmented
                  value={role}
                  onChange={setRole}
                  canAssignManager={canAssignManager}
                />
              </div>

              <div className="flex flex-col gap-2">
                <MethodCard
                  open={method === 'invite'}
                  onOpen={() => setMethod('invite')}
                  icon={<AtSign className="size-3.5" />}
                  title={t('binding.method_invite')}
                  desc={t('binding.method_invite_desc')}
                >
                  <InviteSection
                    groupId={groupId}
                    memberId={memberId}
                    role={role}
                    onChanged={onChanged}
                  />
                </MethodCard>
                <MethodCard
                  open={method === 'link'}
                  onOpen={() => setMethod('link')}
                  icon={<LinkIcon className="size-3.5" />}
                  title={t('binding.method_link')}
                  desc={t('binding.method_link_desc')}
                >
                  <ShareLinkSection
                    groupId={groupId}
                    memberId={memberId}
                    role={role}
                    onChanged={onChanged}
                    baseUrl={baseUrl}
                  />
                </MethodCard>
              </div>
            </div>

            <div
              id={`sent-panel-${memberId}`}
              role="tabpanel"
              aria-labelledby={`sent-tab-${memberId}`}
              aria-hidden={tab !== 'sent'}
              className={cn(
                'col-start-1 row-start-1 min-w-0',
                tab === 'sent' ? 'visible' : 'pointer-events-none invisible',
              )}
            >
              <SentList
                memberName={memberName}
                existingLinks={existingLinks}
                pendingInvitations={pendingInvitations}
                groupId={groupId}
                onChanged={onChanged}
                confirmDialog={confirmDialog}
              />
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
