-- Make Group.createdById / ShareLink.createdById / Settlement.createdById
-- nullable and switch their FKs to ON DELETE SET NULL so a user who
-- transferred ownership of a group (or only ever minted a share link /
-- closed a settlement in someone else's group) can still delete their
-- account. Without this, the original RESTRICT FK silently blocks the
-- account-deletion action and also makes any cascade-driven cleanup leak
-- audit-relevant rows.

-- DropForeignKey
ALTER TABLE "groups" DROP CONSTRAINT "groups_createdById_fkey";

-- DropForeignKey
ALTER TABLE "share_links" DROP CONSTRAINT "share_links_createdById_fkey";

-- DropForeignKey
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_createdById_fkey";

-- AlterTable
ALTER TABLE "groups" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "share_links" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "settlements" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
