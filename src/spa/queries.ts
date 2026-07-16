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
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: (query) => (query.state.data?.user ? 60_000 : false),
  });
}

export function useGroupsQuery(enabled = true) {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => apiRequest<GroupListResponse>('/api/groups'),
    enabled,
  });
}

export function useGroupQuery(groupId: string, enabled = Boolean(groupId)) {
  return useQuery({
    queryKey: ['group', groupId],
    queryFn: () => apiRequest<GroupDetailResponse>(`/api/groups/${encodeURIComponent(groupId)}`),
    enabled,
  });
}

export function useLedgerQuery(groupId: string, enabled = Boolean(groupId)) {
  return useQuery({
    queryKey: ['ledger', groupId],
    queryFn: async () =>
      hydrateLedger(
        await apiRequest<LedgerResponse>(`/api/groups/${encodeURIComponent(groupId)}/ledger`),
      ),
    enabled,
  });
}

export function useAccountQuery(enabled = true) {
  return useQuery({
    queryKey: ['account'],
    queryFn: () => apiRequest<AccountResponse>('/api/account'),
    enabled,
  });
}
