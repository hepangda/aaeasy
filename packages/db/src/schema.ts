import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

const timestampColumn = (name: string) => timestamp(name, { mode: 'date', precision: 3 });
export const groupStatusEnum = pgEnum('GroupStatus', ['ACTIVE', 'ARCHIVED']);
export const groupRoleEnum = pgEnum('GroupRole', ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER']);
export const invitationStatusEnum = pgEnum('InvitationStatus', [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELED',
  'EXPIRED',
]);
export const shareScopeEnum = pgEnum('ShareScope', ['READ', 'WRITE']);
export const splitRuleTypeEnum = pgEnum('SplitRuleType', ['EQUAL', 'SUBSET', 'WEIGHTED']);
export const auditActorTypeEnum = pgEnum('AuditActorType', ['USER', 'SHARE']);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    displayName: text('displayName').notNull(),
    username: text('username'),
    email: text('email'),
    picture: text('picture'),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
    updatedAt: timestampColumn('updatedAt').notNull(),
  },
  (table) => [uniqueIndex('users_username_key').on(table.username)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('tokenHash').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    expiresAt: timestampColumn('expiresAt').notNull(),
    userAgent: text('userAgent'),
    ipHash: text('ipHash'),
    oidcTokens: text('oidcTokens').notNull(),
    oidcValidatedAt: timestampColumn('oidcValidatedAt').notNull(),
    isSuperAdmin: boolean('isSuperAdmin').notNull().default(false),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
    lastSeenAt: timestampColumn('lastSeenAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_tokenHash_key').on(table.tokenHash),
    index('sessions_userId_idx').on(table.userId),
    index('sessions_expiresAt_idx').on(table.expiresAt),
  ],
);

export const groups = pgTable(
  'groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    defaultCurrency: text('defaultCurrency').notNull().default('CNY'),
    status: groupStatusEnum('status').notNull().default('ACTIVE'),
    createdById: text('createdById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
    updatedAt: timestampColumn('updatedAt').notNull(),
    deletedAt: timestampColumn('deletedAt'),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    index('groups_createdById_idx').on(table.createdById),
    index('groups_deletedAt_idx').on(table.deletedAt),
  ],
);

export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    displayName: text('displayName').notNull(),
    linkedUserId: text('linkedUserId').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    color: text('color'),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('members_groupId_idx').on(table.groupId),
    index('members_linkedUserId_idx').on(table.linkedUserId),
  ],
);

export const groupMemberships = pgTable(
  'group_memberships',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    role: groupRoleEnum('role').notNull().default('MEMBER'),
    joinedAt: timestampColumn('joinedAt').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.groupId], name: 'group_memberships_pkey' }),
    index('group_memberships_groupId_idx').on(table.groupId),
  ],
);

export const groupInvitations = pgTable(
  'group_invitations',
  {
    id: text('id').primaryKey(),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    invitedUserId: text('invitedUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    invitedById: text('invitedById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    assignedRole: groupRoleEnum('assignedRole').notNull(),
    status: invitationStatusEnum('status').notNull().default('PENDING'),
    message: varchar('message', { length: 200 }),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
    respondedAt: timestampColumn('respondedAt'),
    expiresAt: timestampColumn('expiresAt'),
  },
  (table) => [
    index('group_invitations_invitedUserId_status_idx').on(table.invitedUserId, table.status),
    index('group_invitations_groupId_status_idx').on(table.groupId, table.status),
    index('group_invitations_memberId_idx').on(table.memberId),
    index('group_invitations_invitedById_idx').on(table.invitedById),
    uniqueIndex('group_invitations_unique_pending_per_member_user')
      .on(table.memberId, table.invitedUserId)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tokenHash: text('tokenHash').notNull(),
    scope: shareScopeEnum('scope').notNull(),
    assignedRole: groupRoleEnum('assignedRole'),
    memberId: text('memberId').references(() => members.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    expiresAt: timestampColumn('expiresAt'),
    revokedAt: timestampColumn('revokedAt'),
    label: text('label'),
    createdById: text('createdById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('share_links_tokenHash_key').on(table.tokenHash),
    index('share_links_groupId_idx').on(table.groupId),
    index('share_links_memberId_idx').on(table.memberId),
    index('share_links_createdById_idx').on(table.createdById),
  ],
);

export const shareSessions = pgTable(
  'share_sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('tokenHash').notNull(),
    shareLinkId: text('shareLinkId')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    expiresAt: timestampColumn('expiresAt').notNull(),
    ipHash: text('ipHash'),
    userAgent: text('userAgent'),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('share_sessions_tokenHash_key').on(table.tokenHash),
    index('share_sessions_shareLinkId_idx').on(table.shareLinkId),
    index('share_sessions_expiresAt_idx').on(table.expiresAt),
  ],
);

export const settlements = pgTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshotJson: jsonb('snapshotJson').notNull(),
    createdById: text('createdById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
  },
  (table) => [index('settlements_groupId_idx').on(table.groupId)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    occurredAt: timestampColumn('occurredAt').notNull(),
    title: text('title').notNull(),
    note: text('note'),
    currency: text('currency').notNull(),
    amountMinor: bigint('amountMinor', { mode: 'bigint' }),
    fxRateToGroupCurrency: numeric('fxRateToGroupCurrency', {
      precision: 20,
      scale: 10,
      mode: 'string',
    }),
    payerMemberId: text('payerMemberId')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    splitRule: jsonb('splitRule'),
    splitInputState: jsonb('splitInputState'),
    tags: text('tags')
      .array()
      .default(sql`ARRAY[]::text[]`),
    createdByUserId: text('createdByUserId').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdByShareLinkId: text('createdByShareLinkId'),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
    updatedAt: timestampColumn('updatedAt').notNull(),
    deletedAt: timestampColumn('deletedAt'),
    lockedBySettlementId: text('lockedBySettlementId').references(() => settlements.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('expenses_groupId_occurredAt_idx').on(table.groupId, table.occurredAt),
    index('expenses_groupId_deletedAt_idx').on(table.groupId, table.deletedAt),
    index('expenses_payerMemberId_idx').on(table.payerMemberId),
    index('expenses_lockedBySettlementId_idx').on(table.lockedBySettlementId),
  ],
);

export const expenseSplits = pgTable(
  'expense_splits',
  {
    id: text('id').primaryKey(),
    expenseId: text('expenseId')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    memberId: text('memberId')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    shareMinor: bigint('shareMinor', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    index('expense_splits_memberId_idx').on(table.memberId),
    uniqueIndex('expense_splits_expenseId_memberId_key').on(table.expenseId, table.memberId),
  ],
);

export const fxRateCache = pgTable(
  'fx_rate_cache',
  {
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    rate: numeric('rate', { precision: 20, scale: 10, mode: 'string' }).notNull(),
    source: text('source').notNull().default('frankfurter'),
    fetchedAt: timestampColumn('fetchedAt').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.base, table.quote, table.date],
      name: 'fx_rate_cache_pkey',
    }),
  ],
);

export const settlementEntries = pgTable(
  'settlement_entries',
  {
    id: text('id').primaryKey(),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    fromMemberId: text('fromMemberId')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    toMemberId: text('toMemberId')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    amountMinor: bigint('amountMinor', { mode: 'bigint' }).notNull(),
    note: text('note'),
    occurredAt: timestampColumn('occurredAt').notNull().defaultNow(),
    createdById: text('createdById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('settlement_entries_groupId_occurredAt_idx').on(table.groupId, table.occurredAt),
    index('settlement_entries_fromMemberId_idx').on(table.fromMemberId),
    index('settlement_entries_toMemberId_idx').on(table.toMemberId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    groupId: text('groupId')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    actorType: auditActorTypeEnum('actorType').notNull(),
    actorId: text('actorId').notNull(),
    action: text('action').notNull(),
    targetType: text('targetType').notNull(),
    targetId: text('targetId').notNull(),
    diffJson: jsonb('diffJson'),
    createdAt: timestampColumn('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_groupId_createdAt_idx').on(table.groupId, table.createdAt),
    index('audit_logs_targetType_targetId_idx').on(table.targetType, table.targetId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(groupMemberships),
}));

export const groupsRelations = relations(groups, ({ many, one }) => ({
  createdBy: one(users, {
    fields: [groups.createdById],
    references: [users.id],
  }),
  members: many(members),
  memberships: many(groupMemberships),
  invitations: many(groupInvitations),
  shareLinks: many(shareLinks),
  expenses: many(expenses),
  settlements: many(settlements),
  settlementEntries: many(settlementEntries),
}));

export const membersRelations = relations(members, ({ many, one }) => ({
  group: one(groups, { fields: [members.groupId], references: [groups.id] }),
  linkedUser: one(users, {
    fields: [members.linkedUserId],
    references: [users.id],
  }),
  splits: many(expenseSplits),
}));

export const expensesRelations = relations(expenses, ({ many, one }) => ({
  group: one(groups, { fields: [expenses.groupId], references: [groups.id] }),
  payer: one(members, {
    fields: [expenses.payerMemberId],
    references: [members.id],
  }),
  splits: many(expenseSplits),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
  expense: one(expenses, {
    fields: [expenseSplits.expenseId],
    references: [expenses.id],
  }),
  member: one(members, {
    fields: [expenseSplits.memberId],
    references: [members.id],
  }),
}));

export type UserRow = typeof users.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
