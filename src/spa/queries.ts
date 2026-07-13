import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import {
  hydrateLedger,
  type AccountResponse,
  type GroupDetailResponse,
  type GroupListResponse,
  type LedgerResponse,
  type SessionResponse,
} from './types';

export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => apiRequest<SessionResponse>('/api/session'),
    staleTime: 30_000,
  });
}

export function useGroupsQuery(enabled = true) {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => apiRequest<GroupListResponse>('/api/groups'),
    enabled,
  });
}

export function useGroupQuery(groupId: string) {
  return useQuery({
    queryKey: ['group', groupId],
    queryFn: () => apiRequest<GroupDetailResponse>(`/api/groups/${encodeURIComponent(groupId)}`),
  });
}

export function useLedgerQuery(groupId: string) {
  return useQuery({
    queryKey: ['ledger', groupId],
    queryFn: async () =>
      hydrateLedger(
        await apiRequest<LedgerResponse>(`/api/groups/${encodeURIComponent(groupId)}/ledger`),
      ),
  });
}

export function useAccountQuery(enabled = true) {
  return useQuery({
    queryKey: ['account'],
    queryFn: () => apiRequest<AccountResponse>('/api/account'),
    enabled,
  });
}
