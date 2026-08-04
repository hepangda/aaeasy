export interface MemberLite {
  id: string;
  displayName: string;
  sortOrder: number;
  linkedUserId: string | null;
  linkedUsername: string | null;
  linkedUserDisplayName: string | null;
  linkedUserPicture: string | null;
  linkedUserRole: 'OWNER' | 'MANAGER' | 'MEMBER' | 'VIEWER' | null;
  color: string | null;
}
