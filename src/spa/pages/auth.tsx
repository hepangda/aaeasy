import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { safeInternalPath } from '../navigation';
import { LoadingPage } from '../page-state';

function ExternalLoginRedirect() {
  const [searchParams] = useSearchParams();
  const next = safeInternalPath(searchParams.get('next'));
  const target = next ? `/api/auth/login?next=${encodeURIComponent(next)}` : '/api/auth/login';

  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return <LoadingPage />;
}

export function LoginPage() {
  return <ExternalLoginRedirect />;
}
