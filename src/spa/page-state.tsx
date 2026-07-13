import Link from '@/compat/link';
import { Button } from '@/components/ui/button';

export function LoadingPage() {
  return (
    <div className="mx-auto flex min-h-64 w-full max-w-3xl items-center justify-center px-6 py-16">
      <div className="text-muted-foreground size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </div>
  );
}

export function ErrorPage({ error }: { error?: unknown }) {
  const status =
    error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
  return (
    <section className="mx-auto flex min-h-64 w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">{status === 404 ? '404' : 'AAEasy'}</h1>
      <p className="text-muted-foreground text-sm">
        {status === 403
          ? 'You do not have access to this page.'
          : status === 404
            ? 'The requested page was not found.'
            : 'Unable to load this page. Please try again.'}
      </p>
      <Button asChild variant="outline">
        <Link href="/">Home</Link>
      </Button>
    </section>
  );
}
