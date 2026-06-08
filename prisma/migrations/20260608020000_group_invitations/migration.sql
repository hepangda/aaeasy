-- Account-binding invitations. A MANAGER/OWNER invites a registered User
-- to bind their account to a specific unlinked Member slot; accept fills
-- Member.linkedUserId + upserts GroupMembership at assignedRole.
--
-- Duplicate live invites for the same (member, user) pair are prevented
-- by the partial unique index at the bottom of this file — Prisma's
-- schema language can't express the WHERE clause, so we add it by hand.

CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED', 'EXPIRED');

CREATE TABLE "group_invitations" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "invitedUserId" TEXT NOT NULL,
    "invitedById" TEXT,
    "assignedRole" "GroupRole" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "message" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "group_invitations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "group_invitations_invitedUserId_status_idx" ON "group_invitations"("invitedUserId", "status");
CREATE INDEX "group_invitations_groupId_status_idx" ON "group_invitations"("groupId", "status");
CREATE INDEX "group_invitations_memberId_idx" ON "group_invitations"("memberId");
CREATE INDEX "group_invitations_invitedById_idx" ON "group_invitations"("invitedById");

-- Race-safe dedup: at most one PENDING row per (memberId, invitedUserId).
-- Rejected / canceled / accepted rows are historical and allowed to coexist.
CREATE UNIQUE INDEX "group_invitations_unique_pending_per_member_user"
    ON "group_invitations"("memberId", "invitedUserId")
    WHERE "status" = 'PENDING';

ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invitedUserId_fkey"
    FOREIGN KEY ("invitedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
