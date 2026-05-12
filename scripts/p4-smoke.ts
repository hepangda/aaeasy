/* eslint-disable */
// Phase 4 e2e smoke. Exercises:
//   1. pgNotify: subscribe → publish → callback fires
//   2. Vercel Blob upload → fetch back the bytes
//   3. Receipt row create + cascade delete with expense.deleteMany

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { put } from '@vercel/blob';
import { setTimeout as wait } from 'node:timers/promises';
import { computeSplit } from '../src/lib/split/index.ts';
import { publish, subscribe } from '../src/lib/realtime/pgNotify.ts';
import {
  BLOB_ACCESS,
  buildReceiptPathname,
  deleteBlob,
  getReceiptBlob,
} from '../src/lib/storage/blob.ts';

const prisma = new PrismaClient();
let ok = 0,
  fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    ok++;
  } else {
    console.log(`  ✗ ${label}`, extra ?? '');
    fail++;
  }
}

async function main() {
  const tag = 'p4_smoke_' + Date.now();
  const user = await prisma.user.create({
    data: { displayName: 'P4 ' + tag, username: tag, passwordHash: 'x' },
  });
  const group = await prisma.group.create({
    data: {
      name: 'Trip ' + tag,
      defaultCurrency: 'CNY',
      createdById: user.id,
      memberships: { create: { userId: user.id, role: 'OWNER' } },
      members: {
        create: [
          { displayName: 'A', linkedUserId: user.id, sortOrder: 0 },
          { displayName: 'B', sortOrder: 1 },
        ],
      },
    },
    include: { members: true },
  });
  const [a, b] = group.members.sort((x, y) => x.sortOrder - y.sortOrder);

  // ─── 1. pg_notify roundtrip ────────────────────────────────────────────
  const events: any[] = [];
  const unsub = await subscribe(group.id, (e) => events.push(e));

  await publish({ type: 'EXPENSE_CREATED', groupId: group.id, expenseId: 'fake' });
  await publish({ type: 'GROUP_UPDATED', groupId: group.id });

  // Allow the LISTEN client time to receive the notifications.
  for (let i = 0; i < 10 && events.length < 2; i++) await wait(100);

  check(
    'subscriber received EXPENSE_CREATED',
    events.some((e) => e.type === 'EXPENSE_CREATED'),
  );
  check(
    'subscriber received GROUP_UPDATED',
    events.some((e) => e.type === 'GROUP_UPDATED'),
  );

  // After unsub no further events should arrive
  unsub();
  events.length = 0;
  await publish({ type: 'MEMBER_CHANGED', groupId: group.id });
  await wait(200);
  check('no events after unsubscribe', events.length === 0);

  // ─── 2. Vercel Blob roundtrip ─────────────────────────────────────────
  const expense = await prisma.expense.create({
    data: {
      groupId: group.id,
      occurredAt: new Date(),
      title: 'Receipt test',
      currency: 'CNY',
      amountMinor: 1000n,
      fxRateToGroupCurrency: new Prisma.Decimal('1'),
      payerMemberId: a.id,
      splitRule: { type: 'EQUAL', memberIds: [a.id, b.id] },
      createdByUserId: user.id,
      splits: {
        create: Array.from(
          computeSplit({
            totalMinor: 1000n,
            rule: { type: 'EQUAL', memberIds: [a.id, b.id] },
          }),
          ([memberId, shareMinor]) => ({ memberId, shareMinor }),
        ),
      },
    },
  });

  const bytes = Buffer.from('hello-receipt-' + tag);
  const mime = 'image/png';
  const pathname = buildReceiptPathname(group.id, expense.id, 'png');

  const blob = await put(pathname, bytes, {
    access: BLOB_ACCESS,
    contentType: mime,
    allowOverwrite: false,
  });
  check('Blob upload succeeded', blob.pathname === pathname);

  const blobResult = await getReceiptBlob(pathname);
  const fetched =
    blobResult?.statusCode === 200
      ? Buffer.from(await new Response(blobResult.stream).arrayBuffer())
      : null;
  check('Blob GET returned same bytes', fetched?.equals(bytes) === true);

  // Receipt row
  const receipt = await prisma.receipt.create({
    data: {
      expenseId: expense.id,
      objectKey: pathname,
      mime,
      sizeBytes: bytes.length,
      uploadedById: user.id,
    },
  });
  check('receipt row created', !!receipt.id);

  // Delete object + row
  await deleteBlob(pathname);
  await prisma.receipt.delete({ where: { id: receipt.id } });
  const stillThere = await prisma.receipt.findUnique({ where: { id: receipt.id } });
  check('receipt row deleted', stillThere === null);

  // Cleanup
  await prisma.expense.deleteMany({ where: { groupId: group.id } });
  await prisma.group.delete({ where: { id: group.id } });
  await prisma.user.delete({ where: { id: user.id } });

  await prisma.$disconnect();
  // The pg LISTEN client is on a global; close it explicitly so the script exits.
  const broker = (globalThis as any).__aaeasy_broker;
  try {
    await broker?.client?.end();
  } catch {}

  console.log(`\nPhase 4 smoke: ${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
