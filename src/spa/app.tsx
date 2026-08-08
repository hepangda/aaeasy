import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';
import { AppLayout } from './app-layout';
import { LocaleProvider } from './locale';
import { queryClient } from './query-client';
import { ErrorPage, LoadingPage } from './page-state';

const HomePage = lazy(() =>
  import('./pages/home').then((module) => ({ default: module.HomePage })),
);
const LoginPage = lazy(() =>
  import('./pages/auth').then((module) => ({ default: module.LoginPage })),
);
const GroupsPage = lazy(() =>
  import('./pages/groups').then((module) => ({ default: module.GroupsPage })),
);
const NewGroupPage = lazy(() =>
  import('./pages/groups').then((module) => ({ default: module.NewGroupPage })),
);
const GroupDetailPage = lazy(() =>
  import('./pages/group-detail').then((module) => ({ default: module.GroupDetailPage })),
);
const NewExpensePage = lazy(() =>
  import('./pages/expense').then((module) => ({ default: module.NewExpensePage })),
);
const EditExpensePage = lazy(() =>
  import('./pages/expense').then((module) => ({ default: module.EditExpensePage })),
);
const AccountPage = lazy(() =>
  import('./pages/account').then((module) => ({ default: module.AccountPage })),
);
const SharePage = lazy(() =>
  import('./pages/share').then((module) => ({ default: module.SharePage })),
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocaleProvider>
          <ConfirmDialogProvider>
            <Suspense fallback={<LoadingPage />}>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route index element={<HomePage />} />
                  <Route path="login" element={<LoginPage />} />
                  <Route path="groups" element={<GroupsPage />} />
                  <Route path="groups/new" element={<NewGroupPage />} />
                  <Route path="groups/:groupId" element={<GroupDetailPage />} />
                  <Route path="groups/:groupId/expenses/new" element={<NewExpensePage />} />
                  <Route
                    path="groups/:groupId/expenses/:expenseId/edit"
                    element={<EditExpensePage />}
                  />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="s/:token" element={<SharePage />} />
                  <Route path="404" element={<ErrorPage />} />
                  <Route path="*" element={<Navigate to="/404" replace />} />
                </Route>
              </Routes>
            </Suspense>
            {/* Toasts sit clear of the sticky header rather than on top of it,
                and are built from the same translucent material as the rest of
                the app's floating chrome — a notification is a floating layer,
                so it should read like one. */}
            <Toaster
              position="top-center"
              richColors
              closeButton
              offset="4.5rem"
              toastOptions={{
                className: 'material-regular material-edge-top shadow-lifted',
              }}
            />
          </ConfirmDialogProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
