import type { GroupEvent } from '@aaeasy/contracts';
import type { Database } from '@aaeasy/db';
import { groups } from '@aaeasy/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function bumpGroupRevision(
  db: Database | Transaction,
  groupId: string,
): Promise<string> {
  const [group] = await db
    .update(groups)
    .set({
      revision: sql`${groups.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(groups.id, groupId))
    .returning({ revision: groups.revision });
  if (!group) throw new Error('GROUP_NOT_FOUND');
  return group.revision.toString();
}

export async function publishToGroup(
  c: Context<AppEnv>,
  groupId: string,
  input: Omit<GroupEvent, 'occurredAt' | 'revision'> & { revision: string },
): Promise<void> {
  const event: GroupEvent = { ...input, occurredAt: new Date().toISOString() };
  await c.env.GROUP_ROOMS.getByName(groupId).publish(event);
}

export function scheduleGroupEvent(
  c: Context<AppEnv>,
  groupId: string,
  input: Omit<GroupEvent, 'occurredAt' | 'revision'> & { revision: string },
): void {
  c.executionCtx.waitUntil(
    publishToGroup(c, groupId, input).catch((error) => console.error('group event failed', error)),
  );
}
