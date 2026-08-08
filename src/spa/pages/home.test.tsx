// @vitest-environment jsdom
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'use-intl';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { HomePage } from './home';

const mocks = vi.hoisted(() => ({
  errorToast: vi.fn(),
}));

vi.mock('@/lib/ui/toast', () => ({
  errorToast: mocks.errorToast,
}));

function LocationProbe() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['session'], { user: null });

  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={messages}>
          <MemoryRouter initialEntries={['/?auth_error=access_denied&source=login']}>
            <Routes>
              <Route
                path="/"
                element={
                  <>
                    <HomePage />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </IntlProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

describe('HomePage auth errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a single localized notice and removes the consumed auth error', async () => {
    renderPage();

    await waitFor(() => {
      expect(mocks.errorToast).toHaveBeenCalledTimes(1);
    });
    expect(mocks.errorToast).toHaveBeenCalledWith(
      'Sign-in was cancelled or not authorized. Please try again.',
    );
    expect(screen.getByTestId('location-search')).toHaveTextContent('?source=login');
  });
});
