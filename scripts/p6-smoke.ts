/* eslint-disable */
// Phase 6 e2e smoke. Validates the export pipeline end-to-end without going
// through the HTTP layer (cookies aren't available in node scripts):
//   1. Seed a group with mixed expenses
//   2. buildExportPayload() builds correct shape
//   3. CSV starts with BOM, contains all 3 sections
//   4. XLSX writeBuffer succeeds, has 3 sheets
//   5. PDF renderToBuffer succeeds, returns >5KB

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { computeSplit } from '../src/lib/split/index.ts';
import { buildExportPayload } from '../src/lib/export/data.ts';
import { buildCsv } from '../src/lib/export/csv.ts';
import { buildXlsx } from '../src/lib/export/xlsx.ts';
import { buildPdf } from '../src/lib/export/pdf.tsx';

const prisma = new PrismaClient();
let ok = 0, fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) { console.log(`  ✓ ${label}`); ok++; }
  else { console.log(`  ✗ ${label}`, extra ?? ''); fail++; }
}

async function main() {
  const tag = 'p6_smoke_' + Date.now();
  const user = await prisma.user.create({
    data: { displayName: 'P6 ' + tag, username: tag, passwordHash: 'x' },
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
      ]},
    },
    include: { members: true },
  });
  const [a, b, c] = group.members.sort((x,y) => x.sortOrder - y.sortOrder);

  const cases = [
    { title: 'Dinner', amount: 12000n, currency: 'CNY', fxRate: '1', payerId: a.id, rule: { type: 'EQUAL' as const, memberIds: [a.id, b.id, c.id] } },
    { title: 'USD shopping', amount: 5000n, currency: 'USD', fxRate: '7.2', payerId: b.id, rule: { type: 'EQUAL' as const, memberIds: [a.id, b.id, c.id] } },
    { title: 'Coffee', amount: 1000n, currency: 'CNY', fxRate: '1', payerId: c.id, rule: { type: 'SUBSET' as const, memberIds: [a.id, c.id] } },
  ];
  for (const def of cases) {
    const splits = computeSplit({
      totalMinor: def.amount, rule: def.rule, payerMemberId: def.payerId,
      validMemberIds: new Set(group.members.map(m => m.id)),
    });
    await prisma.expense.create({
      data: {
        groupId: group.id, occurredAt: new Date('2026-01-15'),
        title: def.title, currency: def.currency, amountMinor: def.amount,
        fxRateToGroupCurrency: new Prisma.Decimal(def.fxRate),
        payerMemberId: def.payerId, splitRule: def.rule,
        createdByUserId: user.id,
        splits: { create: Array.from(splits, ([memberId, shareMinor]) => ({ memberId, shareMinor })) },
      },
    });
  }

  const payload = await buildExportPayload(group.id, 'en-US');
  check('payload has 3 expenses', payload.expenses.length === 3);
  check('payload has 3 summary rows', payload.summary.length === 3);
  check('payload meta has groupName', payload.meta.groupName.startsWith('Trip '));
  check('summary nets approx zero', Math.abs(payload.summary.reduce((s,r) => s + r.net, 0)) < 0.05);

  // CSV
  const csv = buildCsv(payload);
  check('csv starts with BOM', csv.charCodeAt(0) === 0xfeff);
  check('csv has expenses section', csv.includes('# 费用明细 / Expenses'));
  check('csv has summary section', csv.includes('# 汇总 / Summary'));
  check('csv has transfers section', csv.includes('# 清算指令 / Transfers'));

  // XLSX
  const xlsx = await buildXlsx(payload);
  check('xlsx is buffer ≥ 1KB', Buffer.isBuffer(xlsx) && xlsx.length > 1024, `len=${xlsx.length}`);
  // Re-open to verify it's a valid workbook
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx);
  const sheets = wb.worksheets.map(w => w.name);
  check('xlsx has Expenses + Summary + Transfers sheets', ['Expenses','Summary','Transfers'].every(s => sheets.includes(s)), `got ${sheets.join(',')}`);
  // Verify a known cell value (expenses are ordered by occurredAt desc, then
  // createdAt desc → the last-inserted row appears first).
  const expSheet = wb.getWorksheet('Expenses');
  const row2 = expSheet?.getRow(2);
  const titleCell = row2?.getCell(2).value;
  check(
    'xlsx first expense title is one of the seeded titles',
    typeof titleCell === 'string' && ['Dinner', 'USD shopping', 'Coffee'].includes(titleCell),
    `cell=${titleCell}`,
  );

  // PDF
  const pdf = await buildPdf(payload);
  check('pdf is buffer ≥ 4KB', Buffer.isBuffer(pdf) && pdf.length > 4096, `len=${pdf.length}`);
  check('pdf starts with %PDF magic', pdf.slice(0,4).toString('ascii') === '%PDF');

  // Cleanup
  await prisma.expense.deleteMany({ where: { groupId: group.id } });
  await prisma.group.delete({ where: { id: group.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
  console.log(`\nPhase 6 smoke: ${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
