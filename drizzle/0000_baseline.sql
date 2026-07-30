CREATE TYPE "public"."AuditActorType" AS ENUM('USER', 'SHARE');--> statement-breakpoint
CREATE TYPE "public"."GroupRole" AS ENUM('OWNER', 'MANAGER', 'MEMBER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."GroupStatus" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."InvitationStatus" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."ShareScope" AS ENUM('READ', 'WRITE');--> statement-breakpoint
CREATE TYPE "public"."SplitRuleType" AS ENUM('EQUAL', 'SUBSET', 'WEIGHTED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"actorType" "AuditActorType" NOT NULL,
	"actorId" text NOT NULL,
	"action" text NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"diffJson" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_splits" (
	"id" text PRIMARY KEY NOT NULL,
	"expenseId" text NOT NULL,
	"memberId" text NOT NULL,
	"shareMinor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"occurredAt" timestamp (3) NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"currency" text NOT NULL,
	"amountMinor" bigint,
	"fxRateToGroupCurrency" numeric(20, 10),
	"payerMemberId" text NOT NULL,
	"splitRule" jsonb,
	"splitInputState" jsonb,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"isDraft" boolean DEFAULT false NOT NULL,
	"createdByUserId" text,
	"createdByShareLinkId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"deletedAt" timestamp (3),
	"lockedBySettlementId" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rate_cache" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"date" date NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"source" text DEFAULT 'frankfurter' NOT NULL,
	"fetchedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_cache_pkey" PRIMARY KEY("base","quote","date")
);
--> statement-breakpoint
CREATE TABLE "group_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"memberId" text NOT NULL,
	"invitedUserId" text NOT NULL,
	"invitedById" text,
	"assignedRole" "GroupRole" NOT NULL,
	"status" "InvitationStatus" DEFAULT 'PENDING' NOT NULL,
	"message" varchar(200),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"respondedAt" timestamp (3),
	"expiresAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"userId" text NOT NULL,
	"groupId" text NOT NULL,
	"role" "GroupRole" DEFAULT 'MEMBER' NOT NULL,
	"joinedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_pkey" PRIMARY KEY("userId","groupId")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"defaultCurrency" text DEFAULT 'CNY' NOT NULL,
	"status" "GroupStatus" DEFAULT 'ACTIVE' NOT NULL,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"deletedAt" timestamp (3),
	"revision" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"displayName" text NOT NULL,
	"linkedUserId" text,
	"color" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenHash" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"userAgent" text,
	"ipHash" text,
	"oidcTokens" text NOT NULL,
	"oidcValidatedAt" timestamp (3) NOT NULL,
	"isSuperAdmin" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"fromMemberId" text NOT NULL,
	"toMemberId" text NOT NULL,
	"amountMinor" bigint NOT NULL,
	"note" text,
	"occurredAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"snapshotJson" jsonb NOT NULL,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"scope" "ShareScope" NOT NULL,
	"assignedRole" "GroupRole",
	"memberId" text,
	"expiresAt" timestamp (3),
	"revokedAt" timestamp (3),
	"label" text,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenHash" text NOT NULL,
	"shareLinkId" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"ipHash" text,
	"userAgent" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"displayName" text NOT NULL,
	"username" text,
	"email" text,
	"picture" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expenseId_expenses_id_fk" FOREIGN KEY ("expenseId") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payerMemberId_members_id_fk" FOREIGN KEY ("payerMemberId") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByUserId_users_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_lockedBySettlementId_settlements_id_fk" FOREIGN KEY ("lockedBySettlementId") REFERENCES "public"."settlements"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invitedUserId_users_id_fk" FOREIGN KEY ("invitedUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invitedById_users_id_fk" FOREIGN KEY ("invitedById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_linkedUserId_users_id_fk" FOREIGN KEY ("linkedUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_fromMemberId_members_id_fk" FOREIGN KEY ("fromMemberId") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_toMemberId_members_id_fk" FOREIGN KEY ("toMemberId") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_memberId_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "share_sessions" ADD CONSTRAINT "share_sessions_shareLinkId_share_links_id_fk" FOREIGN KEY ("shareLinkId") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "audit_logs_groupId_createdAt_idx" ON "audit_logs" USING btree ("groupId","createdAt");--> statement-breakpoint
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX "expense_splits_memberId_idx" ON "expense_splits" USING btree ("memberId");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_splits_expenseId_memberId_key" ON "expense_splits" USING btree ("expenseId","memberId");--> statement-breakpoint
CREATE INDEX "expenses_groupId_occurredAt_idx" ON "expenses" USING btree ("groupId","occurredAt");--> statement-breakpoint
CREATE INDEX "expenses_groupId_deletedAt_idx" ON "expenses" USING btree ("groupId","deletedAt");--> statement-breakpoint
CREATE INDEX "expenses_payerMemberId_idx" ON "expenses" USING btree ("payerMemberId");--> statement-breakpoint
CREATE INDEX "expenses_lockedBySettlementId_idx" ON "expenses" USING btree ("lockedBySettlementId");--> statement-breakpoint
CREATE INDEX "group_invitations_invitedUserId_status_idx" ON "group_invitations" USING btree ("invitedUserId","status");--> statement-breakpoint
CREATE INDEX "group_invitations_groupId_status_idx" ON "group_invitations" USING btree ("groupId","status");--> statement-breakpoint
CREATE INDEX "group_invitations_memberId_idx" ON "group_invitations" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "group_invitations_invitedById_idx" ON "group_invitations" USING btree ("invitedById");--> statement-breakpoint
CREATE UNIQUE INDEX "group_invitations_unique_pending_per_member_user" ON "group_invitations" USING btree ("memberId","invitedUserId") WHERE "group_invitations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "group_memberships_groupId_idx" ON "group_memberships" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "groups_createdById_idx" ON "groups" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "groups_deletedAt_idx" ON "groups" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "members_groupId_idx" ON "members" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "members_linkedUserId_idx" ON "members" USING btree ("linkedUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sessions_expiresAt_idx" ON "sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "settlement_entries_groupId_occurredAt_idx" ON "settlement_entries" USING btree ("groupId","occurredAt");--> statement-breakpoint
CREATE INDEX "settlement_entries_fromMemberId_idx" ON "settlement_entries" USING btree ("fromMemberId");--> statement-breakpoint
CREATE INDEX "settlement_entries_toMemberId_idx" ON "settlement_entries" USING btree ("toMemberId");--> statement-breakpoint
CREATE INDEX "settlements_groupId_idx" ON "settlements" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "share_links_groupId_idx" ON "share_links" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "share_links_memberId_idx" ON "share_links" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "share_links_createdById_idx" ON "share_links" USING btree ("createdById");--> statement-breakpoint
CREATE UNIQUE INDEX "share_sessions_tokenHash_key" ON "share_sessions" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "share_sessions_shareLinkId_idx" ON "share_sessions" USING btree ("shareLinkId");--> statement-breakpoint
CREATE INDEX "share_sessions_expiresAt_idx" ON "share_sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");