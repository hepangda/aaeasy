DROP INDEX "settlements_groupId_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_groupId_key" ON "settlements" USING btree ("groupId");