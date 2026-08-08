import type { GroupEvent } from '@aaeasy/contracts';
import { useEffect } from 'react';
import { queryClient } from '@/spa/query-client';

/**
 * Which caches a given event actually invalidates.
 *
 * Every event used to refetch both the group detail *and* the whole ledger.
 * An expense write is the common case by a wide margin and touches neither the
 * member list nor the share links, so in a group of N people one person adding
 * an expense cost N-1 redundant group-detail queries.
 */
export function affectedQueryKeys(type: GroupEvent['type'], groupId: string): string[][] {
  switch (type) {
    case 'expense.created':
    case 'expense.updated':
    case 'expense.deleted':
      return [['ledger', groupId]];
    case 'settlement.changed':
      // Closing or reopening a ledger flips group status and the reopen target.
      return [
        ['ledger', groupId],
        ['group', groupId],
      ];
    case 'member.changed':
      return [
        ['ledger', groupId],
        ['group', groupId],
      ];
    case 'group.updated':
      // The name shows up in the sidebar switcher too.
      return [['ledger', groupId], ['group', groupId], ['groups']];
  }
}

/** Subscribe to a group's Durable Object WebSocket and invalidate cached data. */
export function useGroupStream(groupId: string) {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let revision = '0';

    const cached = queryClient.getQueryData<{ group?: { revision?: string } }>(['group', groupId]);
    if (cached?.group?.revision) revision = cached.group.revision;

    function invalidate(queryKeys: string[][]) {
      for (const queryKey of queryKeys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }

    /** Used when the server tells us we are too far behind to replay. */
    function refreshEverything() {
      invalidate([['ledger', groupId], ['group', groupId], ['groups']]);
    }

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(`/api/groups/${groupId}/realtime`, window.location.href);
      url.protocol = protocol;
      url.searchParams.set('since', revision);
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        heartbeatTimer = setInterval(() => socket?.send('ping'), 25_000);
      };

      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(String(message.data)) as {
            type?: string;
            revision?: string;
            event?: GroupEvent;
          };
          if (payload.type === 'event' && payload.event?.revision) {
            revision = payload.event.revision;
            invalidate(affectedQueryKeys(payload.event.type, groupId));
          } else if (payload.type === 'ready' && payload.revision) {
            revision = payload.revision;
          } else if (payload.type === 'resync' && payload.revision) {
            revision = payload.revision;
            refreshEverything();
          }
        } catch {
          refreshEverything();
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        socket = null;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)) + Math.random() * 250;
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket?.close();
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      socket?.close();
    };
  }, [groupId]);
}
