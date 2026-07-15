DROP TABLE "allowed_usernames" CASCADE;--> statement-breakpoint
DROP TABLE "auth_challenges" CASCADE;--> statement-breakpoint
DROP TABLE "passkey_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "password_credentials" CASCADE;--> statement-breakpoint
DELETE FROM "sessions";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "oidcTokens" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "oidcValidatedAt" timestamp (3) NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "isSuperAdmin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "picture" text;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "passwordHash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "isSuperAdmin";--> statement-breakpoint
DROP TYPE "public"."AuthChallengeType";
