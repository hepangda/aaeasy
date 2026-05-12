'use client';

import { useGroupStream } from '@/lib/realtime/use-group-stream';

export function GroupLiveRefresher({ groupId }: { groupId: string }) {
  useGroupStream(groupId);
  return null;
}
