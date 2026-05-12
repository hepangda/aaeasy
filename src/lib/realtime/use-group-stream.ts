'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Subscribe to a group's SSE event stream and call `router.refresh()` on each
 * relevant event so RSC re-renders the latest state. Auto-reconnects with
 * jittered exponential backoff on disconnect.
 *
 * Usage in a server-rendered group page:
 *
 *   <ClientLiveRefresher groupId={group.id} />
 *
 * The hook itself is reusable from any client component.
 */
export function useGroupStream(groupId: string) {
  const router = useRouter();

  useEffect(() => {
    let es: EventSource | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource(`/api/groups/${groupId}/stream`);

      es.onopen = () => {
        attempt = 0;
      };

      const refresh = () => {
        // RSC + router.refresh re-renders the server tree without losing
        // client state. Cheap on a self-hosted single-process backend.
        router.refresh();
      };

      es.addEventListener('EXPENSE_CREATED', refresh);
      es.addEventListener('EXPENSE_UPDATED', refresh);
      es.addEventListener('EXPENSE_DELETED', refresh);
      es.addEventListener('GROUP_UPDATED', refresh);
      es.addEventListener('MEMBER_CHANGED', refresh);
      es.addEventListener('RECEIPT_CHANGED', refresh);

      es.onerror = () => {
        // EventSource auto-retries on its own, but only if the response was
        // 200 with a stream that ended. For 401/403/404 / network error we
        // close + back off ourselves.
        if (cancelled) return;
        es?.close();
        es = null;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)) + Math.random() * 250;
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [groupId, router]);
}
