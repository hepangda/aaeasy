import { useParams } from 'react-router';
import { ShareUnlockForm } from '@/components/share/share-unlock-form';

export function SharePage() {
  const token = useParams<{ token: string }>().token ?? '';
  return (
    <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="bg-foreground text-background grid size-12 place-items-center rounded-xl text-sm font-bold">
        AA
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">AAEasy</h1>
      <ShareUnlockForm token={token} />
    </section>
  );
}
