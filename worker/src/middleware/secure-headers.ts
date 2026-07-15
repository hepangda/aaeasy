import { except } from 'hono/combine';
import { secureHeaders } from 'hono/secure-headers';

const REALTIME_ROUTE = '/api/groups/:groupId/realtime';

/** WebSocket upgrade responses from Durable Objects have immutable headers. */
export function apiSecureHeaders() {
  return except(REALTIME_ROUTE, secureHeaders());
}
