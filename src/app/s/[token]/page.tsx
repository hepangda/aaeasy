import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { hashSessionToken } from '@/lib/auth/tokens';
import { ShareUnlockForm } from '@/components/share-unlock-form';

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      revokedAt: true,
      expiresAt: true,
      group: { select: { name: true } },
    },
  });

  const t = await getTranslations();

  if (!link || link.revokedAt) {
    return (
      <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <h1 className="text-xl font-medium">{t('errors.invalid_link')}</h1>
      </section>
    );
  }

  const expired = link.expiresAt !== null && link.expiresAt <= new Date();

  return (
    <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{link.group.name}</h1>
      {expired && (
        <p className="text-muted-foreground text-sm">{t('share.expired_read_only_notice')}</p>
      )}
      <ShareUnlockForm token={token} />
    </section>
  );
}
