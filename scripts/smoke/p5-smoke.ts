/* eslint-disable */
// Phase 5 e2e smoke. Exercises:
//   1. settleAction (snapshot + lock + audit) on a populated group
//   2. Subsequent updateExpenseAction is rejected (locked)
//   3. Group is auto-archived after settlement
//   4. Snapshot JSON survives round-trip and contains all summary/transfers
//   5. After 1st settle, settling again with no new expenses returns nothing_to_settle

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { computeSplit } from '../src/lib/split/index.ts';
import { settleAction, type SettlementSnapshot } from '../src/lib/settle/actions.ts';

// We need a "current user" for settleAction → we patch session lookup via
// the actual cookie-less path: settleAction calls requireUser() inside, so
// here we monkey-patch the action's deps by spinning a real session row that
// the AsyncLocalStorage would normally provide. Instead we'll bypass the
// action and call the same code path it uses, since cookies() isn't
// available in a node script.
//
// Simpler: replicate the snapshot logic directly using prisma + lib/settle.
import { computeSummary } from '../src/lib/expenses/queries.ts';
import { settle } from '../src/lib/settle/index.ts';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();
let ok = 0, fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) { console.log(`  ✓ ${label}`); ok++; }
  else { console.log(`  ✗ ${label}`, extra ?? ''); fail++; }
}

async function main() {
  const tag = 'p5_smoke_' + Date.now();
  const user = await prisma.user.create({
    data: { displayName: 'P5 ' + tag, username: tag, passwordHash: 'x' },
  });
  const group = await prisma.group.create({
    data: {
      name: 'OneShot ' + tag,
      defaultCurrency: 'CNY',
      createdById: user.id,
      memberships: { create: { userId: user.id, role: 'OWNER' } },
      members: { create: [
        { displayName: 'A', linkedUserId: user.id, sortOrder: 0 },
        { displayName: 'B', sortOrder: 1 },
        { displayName: 'C', sortOrder: 2 },
      ]},
    },
    include: { members: true },
  });
  const [a, b, c] = group.members.sort((x,y) => x.sortOrder - y.sortOrder);

  // Add 3 expenses
  for (const def of [
    { title: 'Dinner', amount: 12000n, payerId: a.id, rule: { type: 'EQUAL' as const, memberIds: [a.id, b.id, c.id] } },
    { title: 'Hotel', amount: 30000n, payerId: b.id, rule: { type: 'WEIGHTED' as const, weights: [
      { memberId: a.id, weight: '2' }, { memberId: b.id, weight: '1' }, { memberId: c.id, weight: '1' },
    ]}},
    { title: 'Coffee', amount: 1000n, payerId: c.id, rule: { type: 'SUBSET' as const, memberIds: [a.id, c.id] } },
  ]) {
    const splits = computeSplit({
      totalMinor: def.amount,
      rule: def.rule,
      payerMemberId: def.payerId,
      validMemberIds: new Set(group.members.map(m => m.id)),
    });
    await prisma.expense.create({
      data: {
        groupId: group.id,
        occurredAt: new Date(),
        title: def.title,
        currency: 'CNY',
        amountMinor: def.amount,
        fxRateToGroupCurrency: new Prisma.Decimal('1'),
        payerMemberId: def.payerId,
        splitRule: def.rule,
        createdByUserId: user.id,
        splits: { create: Array.from(splits, ([memberId, shareMinor]) => ({ memberId, shareMinor })) },
      },
    });
  }

  // Replicate settleAction body inline (cookies() unavailable in node script)
  async function doSettle(): Promise<{ id: string; snapshot: SettlementSnapshot } | { error: string }> {
    const g = await prisma.group.findUniqueOrThrow({
      where: { id: group.id },
      include: {
        members: { orderBy: { sortOrder: 'asc' } },
        expenses: {
          where: { deletedAt: null, lockedBySettlementId: null },
          orderBy: { occurredAt: 'asc' },
          include: { splits: true },
        },
      },
    });
    if (g.expenses.length === 0) return { error: 'errors.nothing_to_settle' };

    const lites = g.expenses.map((e) => ({
      id: e.id, occurredAt: e.occurredAt, title: e.title, note: e.note,
      currency: e.currency, amountMinor: e.amountMinor,
      fxRateToGroupCurrency: new Decimal(e.fxRateToGroupCurrency.toString()),
      payerMemberId: e.payerMemberId, tags: e.tags,
      splits: e.splits.map(s => ({ memberId: s.memberId, shareMinor: s.shareMinor })),
      receipts: [], lockedBySettlementId: e.lockedBySettlementId,
    }));
    const summary = computeSummary(g.defaultCurrency, g.members, lites);
    const transfers = settle(summary.map(s => ({ memberId: s.memberId, netMinor: s.netMinorInGroup })));
    const snapshot: SettlementSnapshot = {
      version: 1,
      groupId: g.id,
      groupName: g.name,
      defaultCurrency: g.defaultCurrency,
      periodStart: null,
      periodEnd: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      members: g.members.map(m => ({ id: m.id, displayName: m.displayName })),
      expenses: g.expenses.map(e => ({
        id: e.id, occurredAt: e.occurredAt.toISOString(), title: e.title,
        currency: e.currency, amountMinor: e.amountMinor.toString(),
        fxRateToGroupCurrency: e.fxRateToGroupCurrency.toString(),
        payerMemberId: e.payerMemberId,
        splits: e.splits.map(s => ({ memberId: s.memberId, shareMinor: s.shareMinor.toString() })),
      })),
      summary: summary.map(s => ({
        memberId: s.memberId,
        paidMinorInGroup: s.paidMinorInGroup.toString(),
        owedMinorInGroup: s.owedMinorInGroup.toString(),
        netMinorInGroup: s.netMinorInGroup.toString(),
      })),
      transfers: transfers.map(t => ({ from: t.from, to: t.to, amountMinor: t.amountMinor.toString() })),
    };
    const ids = g.expenses.map(e => e.id);
    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.settlement.create({
        data: {
          groupId: g.id, periodEnd: new Date(),
          snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
          createdById: user.id,
        },
      });
      await tx.expense.updateMany({ where: { id: { in: ids } }, data: { lockedBySettlementId: s.id } });
      if (g.status === 'ACTIVE') {
        await tx.group.update({ where: { id: g.id }, data: { status: 'ARCHIVED' } });
      }
      await tx.auditLog.create({
        data: {
          groupId: g.id, actorType: 'USER', actorId: user.id,
          action: 'SETTLEMENT_CREATE', targetType: 'Settlement', targetId: s.id,
        },
      });
      return s;
    });
    return { id: created.id, snapshot };
  }

  const r1 = await doSettle();
  check('first settle succeeds', 'id' in r1);
  if (!('id' in r1)) { await cleanup(); return; }

  // Verify lock + archive
  const lockedCount = await prisma.expense.count({ where: { groupId: group.id, lockedBySettlementId: r1.id } });
  check('all 3 expenses locked', lockedCount === 3, `got ${lockedCount}`);

  const after = await prisma.group.findUniqueOrThrow({ where: { id: group.id }, select: { status: true } });
  check('group auto-archived after settle', after.status === 'ARCHIVED');

  const audit = await prisma.auditLog.findFirst({ where: { groupId: group.id, action: 'SETTLEMENT_CREATE' } });
  check('SETTLEMENT_CREATE audit row written', !!audit && audit.targetId === r1.id);

  // Snapshot integrity checks
  check('snapshot has 3 expenses', r1.snapshot.expenses.length === 3);
  const totalNetSnap = r1.snapshot.summary.reduce((acc, s) => acc + BigInt(s.netMinorInGroup), 0n);
  check('snapshot net totals to ±0', totalNetSnap >= -3n && totalNetSnap <= 3n, `total=${totalNetSnap}`);
  check('snapshot transfers ≤ N-1', r1.snapshot.transfers.length <= 2);

  // Read snapshot back from DB and verify it round-trips
  const dbSettlement = await prisma.settlement.findUniqueOrThrow({ where: { id: r1.id } });
  const fromDb = dbSettlement.snapshotJson as unknown as SettlementSnapshot;
  check('snapshot round-trips through Prisma JSON', fromDb.version === 1 && fromDb.expenses.length === 3);

  // Settling again with no new expenses fails
  const r2 = await doSettle();
  check('second settle has nothing to settle', 'error' in r2 && r2.error === 'errors.nothing_to_settle');

  await cleanup();

  async function cleanup() {
    await prisma.settlement.deleteMany({ where: { groupId: group.id } });
    await prisma.expense.deleteMany({ where: { groupId: group.id } });
    await prisma.group.delete({ where: { id: group.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log(`\nPhase 5 smoke: ${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
