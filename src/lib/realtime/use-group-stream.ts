import { useEffect } from 'react';
import { queryClient } from '@/spa/query-client';

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

    function refresh() {
      void queryClient.invalidateQueries({ queryKey: ['group', groupId] });
      void queryClient.invalidateQueries({ queryKey: ['ledger', groupId] });
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
            event?: { revision?: string };
          };
          if (payload.type === 'event' && payload.event?.revision) {
            revision = payload.event.revision;
            refresh();
          } else if (payload.type === 'ready' && payload.revision) {
            revision = payload.revision;
          } else if (payload.type === 'resync' && payload.revision) {
            revision = payload.revision;
            refresh();
          }
        } catch {
          refresh();
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
