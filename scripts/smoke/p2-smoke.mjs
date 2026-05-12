/* eslint-disable */
// Phase 2 end-to-end smoke test against the local DB.
// Exercises: user creation, group + members, share link creation, share link
// lookup, share session creation, revoke cascade.

import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes, createHash } from 'node:crypto';

const prisma = new PrismaClient();

const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
function token() { return randomBytes(32).toString('base64url'); }
function sha(s) { return createHash('sha256').update(s).digest('hex'); }

let ok = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); ok++; }
  else { console.log(`  ✗ ${label}`); fail++; }
}

const tag = 'p2_smoke_' + Date.now();
const user = await prisma.user.create({
  data: { displayName: 'Owner ' + tag, username: tag, passwordHash: await hash('pw_' + tag, ARGON) },
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
check('group created with 3 members', group.members.length === 3);
check('owner membership exists', !!(await prisma.groupMembership.findUnique({
  where: { userId_groupId: { userId: user.id, groupId: group.id } },
})));

// Share link without password
const t1 = token();
const link1 = await prisma.shareLink.create({
  data: {
    groupId: group.id,
    tokenHash: sha(t1),
    scope: 'WRITE',
    createdById: user.id,
  },
});
check('share link created (WRITE)', !!link1);

// Read-only share link with expiry
const t2 = token();
const link2 = await prisma.shareLink.create({
  data: {
    groupId: group.id,
    tokenHash: sha(t2),
    scope: 'READ',
    expiresAt: new Date(Date.now() + 60_000),
    createdById: user.id,
  },
});
check('share link created (READ, with expiry)', !!link2);

// Look up by token
const found = await prisma.shareLink.findUnique({ where: { tokenHash: sha(t1) } });
check('shareLink lookup by tokenHash', found?.id === link1.id);
const wrongLookup = await prisma.shareLink.findUnique({ where: { tokenHash: sha('not-a-token') } });
check('lookup with wrong token returns null', wrongLookup === null);

// Create share session (mimics createShareSession)
const sessTok = token();
const sess = await prisma.shareSession.create({
  data: {
    tokenHash: sha(sessTok),
    shareLinkId: link1.id,
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
  },
});
const sessLookup = await prisma.shareSession.findUnique({
  where: { tokenHash: sha(sessTok) },
  include: { shareLink: true },
});
check('share session created & looked up', sessLookup?.shareLink.groupId === group.id);

// Revoke link cascades to sessions (we delete sessions explicitly in the action)
await prisma.shareLink.update({ where: { id: link1.id }, data: { revokedAt: new Date() } });
await prisma.shareSession.deleteMany({ where: { shareLinkId: link1.id } });
const afterRevoke = await prisma.shareSession.findUnique({ where: { tokenHash: sha(sessTok) } });
check('share sessions purged after revoke', afterRevoke === null);

// Cleanup
await prisma.group.delete({ where: { id: group.id } }); // cascades to members/memberships/links/sessions
await prisma.session.deleteMany({ where: { userId: user.id } });
await prisma.user.delete({ where: { id: user.id } });

await prisma.$disconnect();
console.log(`\nPhase 2 smoke: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
