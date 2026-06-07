-- Soft-delete tombstone on groups. When non-null, the group is hidden
-- from every listing, detail page, and API. Mirrors Expense.deletedAt.

ALTER TABLE "groups" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "groups_deletedAt_idx" ON "groups"("deletedAt");
