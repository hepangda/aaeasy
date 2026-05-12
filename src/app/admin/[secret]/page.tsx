import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';

export default async function PromoteAdminPage({
  params,
}: {
  params: Promise<{ secret: string }>;
}) {
  const { secret } = await params;
  const expectedSecret = process.env.ADMIN_SECRET;
  if (!expectedSecret || secret !== expectedSecret) notFound();

  const ctx = await getCurrentSession();
  if (!ctx) redirect('/login');

  if (!ctx.user.isSuperAdmin) {
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: { isSuperAdmin: true },
    });
  }

  redirect('/account/admin/usernames');
}
