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

/**
 * The signed-in user.
 *
 * Revalidated when the tab regains focus or the network comes back, which is
 * when a session actually tends to have changed underneath us. There is no
 * background poll: a fixed interval hit the database — and, every fifth
 * minute, the identity provider — for every open tab of every user, whether or
 * not anyone was looking.
 */
export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => apiRequest<SessionResponse>('/api/session'),
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
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

export function useLedgerQuery(groupId: string, page = 1, enabled = Boolean(groupId)) {
  return useQuery({
    queryKey: ['ledger', groupId, page],
    queryFn: async () =>
      hydrateLedger(
        await apiRequest<LedgerResponse>(
          `/api/groups/${encodeURIComponent(groupId)}/ledger?page=${encodeURIComponent(page)}`,
        ),
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
