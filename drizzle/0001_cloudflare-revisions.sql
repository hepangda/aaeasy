ALTER TABLE "expenses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;
