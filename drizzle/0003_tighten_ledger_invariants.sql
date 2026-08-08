-- Invariants the code already assumed but the schema did not enforce.
--
-- 1. An expense without an amount, an FX rate or a split rule is not an
--    expense. Those columns were nullable only for the half-entered "draft"
--    mode removed in d0f9d62, and every reader had to re-check them at
--    runtime (settlement refused to close a ledger containing one). Surviving
--    drafts are retired rather than deleted -- the row stays for history, with
--    inert values that satisfy the constraint and still validate against
--    `splitRuleSchema`.
UPDATE "expenses"
SET "deletedAt" = COALESCE("deletedAt", now()),
    "amountMinor" = COALESCE("amountMinor", 0),
    "fxRateToGroupCurrency" = COALESCE("fxRateToGroupCurrency", 1),
    "splitRule" = COALESCE(
      "splitRule",
      jsonb_build_object('type', 'SUBSET', 'memberIds', jsonb_build_array("payerMemberId"))
    )
WHERE "amountMinor" IS NULL
   OR "fxRateToGroupCurrency" IS NULL
   OR "splitRule" IS NULL;--> statement-breakpoint

-- 2. `createdByShareLinkId` recorded a share link but carried no foreign key,
--    unlike every other actor column on the table. Drop references that no
--    longer resolve before the constraint goes on.
UPDATE "expenses"
SET "createdByShareLinkId" = NULL
WHERE "createdByShareLinkId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "share_links" WHERE "share_links"."id" = "expenses"."createdByShareLinkId"
  );--> statement-breakpoint

-- 3. Usernames are owned case-insensitively by the identity provider and every
--    lookup here compares `lower(username)`, but the unique index was on the
--    raw column -- so those lookups could not use it, and `Alice` / `alice`
--    could coexist. Release the older claim on any alias that collides only by
--    case; the next sign-in re-syncs it from the provider.
UPDATE "users"
SET "username" = NULL, "updatedAt" = now()
WHERE "username" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "users" "other"
    WHERE "other"."username" IS NOT NULL
      AND lower("other"."username") = lower("users"."username")
      AND ("other"."updatedAt", "other"."id") > ("users"."updatedAt", "users"."id")
  );--> statement-breakpoint

-- 4. "One member row per user per group" was enforced by hand in three routes
--    (`errors.user_already_linked_in_group`). Unlink the later duplicates so
--    the index can go on; the earliest claim is the one that kept the history.
UPDATE "members"
SET "linkedUserId" = NULL
WHERE "linkedUserId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "members" "other"
    WHERE "other"."groupId" = "members"."groupId"
      AND "other"."linkedUserId" = "members"."linkedUserId"
      AND ("other"."createdAt", "other"."id") < ("members"."createdAt", "members"."id")
  );--> statement-breakpoint

DROP INDEX "settlements_groupId_key";--> statement-breakpoint
DROP INDEX "users_username_key";--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "amountMinor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "fxRateToGroupCurrency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "splitRule" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "reopenedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "reopenedById" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByShareLinkId_share_links_id_fk" FOREIGN KEY ("createdByShareLinkId") REFERENCES "public"."share_links"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_reopenedById_users_id_fk" FOREIGN KEY ("reopenedById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "expenses_createdByShareLinkId_idx" ON "expenses" USING btree ("createdByShareLinkId");--> statement-breakpoint
CREATE UNIQUE INDEX "members_groupId_linkedUserId_key" ON "members" USING btree ("groupId","linkedUserId") WHERE "members"."linkedUserId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_groupId_active_key" ON "settlements" USING btree ("groupId") WHERE "settlements"."reopenedAt" is null;--> statement-breakpoint
CREATE INDEX "settlements_groupId_createdAt_idx" ON "settlements" USING btree ("groupId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "users_username_lower_pattern_idx" ON "users" USING btree (lower("username") text_pattern_ops);--> statement-breakpoint

-- The `SplitRuleType` enum was never referenced by a column: split rules are
-- stored as jsonb, and the enum did not even list `EXACT`.
DROP TYPE "public"."SplitRuleType";
