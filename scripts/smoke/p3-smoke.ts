/* eslint-disable */
// Phase 3 e2e smoke. Creates a group + 4 members, adds 5 expenses with
// mixed currencies and split rules (incl. one in CNY paid by Alice, one in
// USD paid by Bob with manual fx rate, weighted shares, subset, equal),
// then verifies summary + transfer count.

import { PrismaClient, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { computeSplit } from '../src/lib/split/index.ts';
import { settle } from '../src/lib/settle/index.ts';
import { decimalToMinor, minorToDecimal } from '../src/lib/money/index.ts';

const prisma = new PrismaClient();
let ok = 0, fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) { console.log(`  ✓ ${label}`); ok++; }
  else { console.log(`  ✗ ${label}`, extra ?? ''); fail++; }
}

async function main() {
const tag = 'p3_smoke_' + Date.now();
const user = await prisma.user.create({
  data: { displayName: 'P3 ' + tag, username: tag, passwordHash: 'x' },
});

const group = await prisma.group.create({
  data: {
    name: 'Trip ' + tag,
    defaultCurrency: 'CNY',
    createdById: user.id,
    memberships: { create: { userId: user.id, role: 'OWNER' } },
    members: { create: [
      { displayName: 'Alice', linkedUserId: user.id, sortOrder: 0 },
      { displayName: 'Bob', sortOrder: 1 },
      { displayName: 'Carol', sortOrder: 2 },
      { displayName: 'Dave', sortOrder: 3 },
    ]},
  },
  include: { members: true },
});
const sortedMembers = [...group.members].sort((a,b) => a.sortOrder - b.sortOrder);
const [alice, bob, carol, dave] = sortedMembers;

async function add(opts: any) {
  const splits = computeSplit({
    totalMinor: opts.amountMinor,
    rule: opts.rule,
    payerMemberId: opts.payerId,
    validMemberIds: new Set(group.members.map(m => m.id)),
  });
  return prisma.expense.create({
    data: {
      groupId: group.id,
      occurredAt: new Date(),
      title: opts.title,
      currency: opts.currency,
      amountMinor: opts.amountMinor,
      fxRateToGroupCurrency: new Prisma.Decimal(opts.fxRate ?? '1'),
      payerMemberId: opts.payerId,
      splitRule: opts.rule,
      createdByUserId: user.id,
      splits: { create: Array.from(splits, ([memberId, shareMinor]) => ({ memberId, shareMinor })) },
    },
    include: { splits: true },
  });
}

const e1 = await add({
  title: 'Dinner', currency: 'CNY', amountMinor: 12000n, payerId: alice.id,
  rule: { type: 'EQUAL', memberIds: group.members.map(m => m.id) },
});
check('e1 splits sum', e1.splits.reduce((a,s) => a + s.shareMinor, 0n) === 12000n);

const e2 = await add({
  title: 'Coffee', currency: 'CNY', amountMinor: 1000n, payerId: bob.id,
  rule: { type: 'SUBSET', memberIds: [alice.id, bob.id, carol.id] },
});
check('e2 splits sum', e2.splits.reduce((a,s) => a + s.shareMinor, 0n) === 1000n);
check('e2 dave excluded', !e2.splits.some(s => s.memberId === dave.id));

const e3 = await add({
  title: 'Hotel', currency: 'CNY', amountMinor: 50000n, payerId: carol.id,
  rule: { type: 'WEIGHTED', weights: [
    { memberId: alice.id, weight: '2' },
    { memberId: bob.id, weight: '1' },
    { memberId: carol.id, weight: '1' },
    { memberId: dave.id, weight: '1' },
  ]},
});
const aliceShare = e3.splits.find(s => s.memberId === alice.id)?.shareMinor;
check('e3 alice = 20000', aliceShare === 20000n);
check('e3 sums', e3.splits.reduce((a,s) => a + s.shareMinor, 0n) === 50000n);

const e4 = await add({
  title: 'Souvenirs', currency: 'USD', amountMinor: 3000n, fxRate: '7.20', payerId: dave.id,
  rule: { type: 'EQUAL', memberIds: group.members.map(m => m.id) },
});
check('e4 USD splits sum', e4.splits.reduce((a,s) => a + s.shareMinor, 0n) === 3000n);

const e5 = await add({
  title: 'Taxi', currency: 'CNY', amountMinor: 700n, payerId: alice.id,
  rule: { type: 'SUBSET', memberIds: [alice.id, bob.id, dave.id] },
});
check('e5 splits sum', e5.splits.reduce((a,s) => a + s.shareMinor, 0n) === 700n);

const exps = await prisma.expense.findMany({
  where: { groupId: group.id, deletedAt: null },
  include: { splits: true },
});
const paid = new Map<string, bigint>(group.members.map(m => [m.id, 0n]));
const owed = new Map<string, bigint>(group.members.map(m => [m.id, 0n]));
for (const e of exps) {
  const rate = new Decimal(e.fxRateToGroupCurrency.toString());
  const groupAmount = e.currency === 'CNY' ? e.amountMinor : decimalToMinor(minorToDecimal(e.amountMinor, e.currency).times(rate), 'CNY');
  paid.set(e.payerMemberId, paid.get(e.payerMemberId)! + groupAmount);
  if (groupAmount === 0n) continue;
  const ordered = [...e.splits].sort((a,b) => a.memberId < b.memberId ? -1 : 1);
  let assigned = 0n;
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i]!;
    const isLast = i === ordered.length - 1;
    let conv: bigint;
    if (isLast) conv = groupAmount - assigned;
    else { conv = e.currency === 'CNY' ? s.shareMinor : decimalToMinor(minorToDecimal(s.shareMinor, e.currency).times(rate), 'CNY'); assigned += conv; }
    owed.set(s.memberId, owed.get(s.memberId)! + conv);
  }
}

const balances = group.members.map(m => ({ memberId: m.id, netMinor: paid.get(m.id)! - owed.get(m.id)! }));
const totalNet = balances.reduce((a,b) => a + b.netMinor, 0n);
check('paid - owed nets to (near) zero', totalNet >= -BigInt(group.members.length) && totalNet <= BigInt(group.members.length), `total=${totalNet}`);
const transfers = settle(balances);
check('settle ≤ N-1 transfers', transfers.length <= group.members.length - 1, `got ${transfers.length}`);
const after = new Map(balances.map(b => [b.memberId, b.netMinor]));
for (const t of transfers) {
  after.set(t.from, after.get(t.from)! + t.amountMinor);
  after.set(t.to, after.get(t.to)! - t.amountMinor);
}
check('all balances become zero after transfers', [...after.values()].every(v => v === 0n));

await prisma.expense.deleteMany({ where: { groupId: group.id } });
await prisma.group.delete({ where: { id: group.id } });
await prisma.user.delete({ where: { id: user.id } });
await prisma.$disconnect();
console.log(`\nPhase 3 smoke: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
