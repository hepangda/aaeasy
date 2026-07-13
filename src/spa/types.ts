import type {
  GroupAccessDto,
  GroupRole,
  GroupStatus,
  SessionUserDto,
  ShareScope,
} from '@aaeasy/contracts';

export interface SessionResponse {
  user: SessionUserDto | null;
}

export interface GroupListResponse {
  groups: Array<{
    id: string;
    name: string;
    status: GroupStatus;
    defaultCurrency: string;
    role: GroupRole;
    memberCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  invitations: Array<{
    id: string;
    groupId: string;
    memberId: string;
    assignedRole: GroupRole;
    message: string | null;
    createdAt: string;
    groupName: string;
    memberDisplayName: string;
    inviterId: string | null;
    inviterDisplayName: string | null;
    inviterUsername: string | null;
  }>;
}

export interface ExistingShareLinkDto {
  id: string;
  memberId: string | null;
  label: string | null;
  scope: ShareScope;
  assignedRole: GroupRole | null;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  revoked: boolean;
}

export interface PendingMemberInvitationDto {
  id: string;
  memberId: string;
  assignedRole: GroupRole;
  createdAt: string;
  invitedUserId: string;
  invitedById: string | null;
  invitedUser: {
    id: string;
    displayName: string;
    username: string | null;
  } | null;
  invitedBy: {
    id: string;
    displayName: string;
    username: string | null;
  } | null;
}

export interface GroupDetailResponse {
  group: {
    id: string;
    name: string;
    defaultCurrency: string;
    status: GroupStatus;
    revision: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
  access: GroupAccessDto & {
    userId?: string | null;
    bypass?: 'superadmin' | null;
  };
  members: Array<{
    id: string;
    displayName: string;
    linkedUserId: string | null;
    linkedUsername: string | null;
    color: string | null;
    sortOrder: number;
    createdAt: string;
    role: GroupRole | null;
  }>;
  shareLinks: ExistingShareLinkDto[];
  pendingInvitations: PendingMemberInvitationDto[];
  latestSettlementId: string | null;
}

export interface LedgerMember {
  id: string;
  displayName: string;
  sortOrder: number;
  linkedUserId: string | null;
  linkedUsername: string | null;
  linkedUserDisplayName: string | null;
  linkedUserRole: GroupRole | null;
  color: string | null;
}

export interface LedgerExpense {
  id: string;
  groupId: string;
  occurredAt: Date;
  title: string;
  note: string | null;
  currency: string;
  amountMinor: bigint | null;
  fxRateToGroupCurrency: string | null;
  payerMemberId: string;
  splitRule: unknown;
  splitInputState: unknown;
  tags: string[];
  lockedBySettlementId: string | null;
  isDraft: boolean;
  version: number;
  splits: Array<{ id: string; memberId: string; shareMinor: bigint }>;
  receipts: Array<{ id: string; mime: string; sizeBytes: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerResponse {
  group: {
    id: string;
    name: string;
    defaultCurrency: string;
    status: GroupStatus;
    revision: string;
  };
  members: LedgerMember[];
  expenses: Array<
    Omit<LedgerExpense, 'occurredAt' | 'amountMinor' | 'splits' | 'createdAt' | 'updatedAt'> & {
      occurredAt: string;
      amountMinor: string | null;
      splits: Array<{ id: string; memberId: string; shareMinor: string }>;
      createdAt: string;
      updatedAt: string;
    }
  >;
  summary: Array<{
    memberId: string;
    paidMinorInGroup: string;
    owedMinorInGroup: string;
    netMinorInGroup: string;
    adjustedNetMinorInGroup: string;
  }>;
  transfers: Array<{ from: string; to: string; amountMinor: string }>;
  settlementEntries: Array<{
    id: string;
    fromMemberId: string;
    toMemberId: string;
    amountMinor: string;
    note: string | null;
    occurredAt: string;
    createdByName: string | null;
  }>;
}

export interface HydratedLedger {
  group: LedgerResponse['group'];
  members: LedgerMember[];
  expenses: LedgerExpense[];
  summary: Array<{
    memberId: string;
    paidMinorInGroup: bigint;
    owedMinorInGroup: bigint;
    netMinorInGroup: bigint;
    adjustedNetMinorInGroup: bigint;
  }>;
  transfers: Array<{ from: string; to: string; amountMinor: bigint }>;
  settlementEntries: Array<{
    id: string;
    fromMemberId: string;
    toMemberId: string;
    amountMinor: bigint;
    note: string | null;
    occurredAt: Date;
    createdByName: string | null;
  }>;
}

export function hydrateLedger(raw: LedgerResponse): HydratedLedger {
  return {
    ...raw,
    expenses: raw.expenses.map((expense) => ({
      ...expense,
      occurredAt: new Date(expense.occurredAt),
      amountMinor: expense.amountMinor === null ? null : BigInt(expense.amountMinor),
      splits: expense.splits.map((split) => ({
        ...split,
        shareMinor: BigInt(split.shareMinor),
      })),
      createdAt: new Date(expense.createdAt),
      updatedAt: new Date(expense.updatedAt),
    })),
    summary: raw.summary.map((row) => ({
      ...row,
      paidMinorInGroup: BigInt(row.paidMinorInGroup),
      owedMinorInGroup: BigInt(row.owedMinorInGroup),
      netMinorInGroup: BigInt(row.netMinorInGroup),
      adjustedNetMinorInGroup: BigInt(row.adjustedNetMinorInGroup),
    })),
    transfers: raw.transfers.map((transfer) => ({
      ...transfer,
      amountMinor: BigInt(transfer.amountMinor),
    })),
    settlementEntries: raw.settlementEntries.map((entry) => ({
      ...entry,
      amountMinor: BigInt(entry.amountMinor),
      occurredAt: new Date(entry.occurredAt),
    })),
  };
}

export interface ExpenseResponse {
  expense: LedgerResponse['expenses'][number];
}

export interface AccountResponse {
  user: SessionUserDto;
  session: { userAgent: string | null };
  credentials: Array<{
    id: string;
    kind: 'passkey' | 'password';
    label: string | null;
    transports: string[];
    createdAt: string;
    lastUsedAt: string | null;
  }>;
  ownedGroups: Array<{ id: string; name: string; memberCount: number }>;
  allLedgers: Array<{
    id: string;
    name: string;
    defaultCurrency: string;
    createdAt: string;
    deletedAt: string | null;
    memberCount: number;
  }>;
}
