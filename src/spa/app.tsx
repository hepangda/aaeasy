import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { IntlProvider } from 'use-intl';
import { Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';
import { AppLayout } from './app-layout';
import { queryClient } from './query-client';
import { ErrorPage, LoadingPage } from './page-state';

const HomePage = lazy(() =>
  import('./pages/home').then((module) => ({ default: module.HomePage })),
);
const LoginPage = lazy(() =>
  import('./pages/auth').then((module) => ({ default: module.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('./pages/auth').then((module) => ({ default: module.RegisterPage })),
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
const AdminUsernamesPage = lazy(() =>
  import('./pages/account').then((module) => ({ default: module.AdminUsernamesPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/account').then((module) => ({ default: module.AdminUsersPage })),
);
const SharePage = lazy(() =>
  import('./pages/share').then((module) => ({ default: module.SharePage })),
);

type Locale = 'zh' | 'en';

function initialLocale(): Locale {
  const stored = window.localStorage.getItem('aaeasy_locale');
  if (stored === 'zh' || stored === 'en') return stored;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('aaeasy_locale='))
    ?.split('=')[1];
  if (cookie === 'zh' || cookie === 'en') return cookie;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const locale = initialLocale();
const messages = locale === 'zh' ? zh : en;
document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
document.title = `${messages.app.name} · ${messages.app.tagline}`;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <IntlProvider
          locale={locale}
          messages={messages}
          timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          formats={{
            dateTime: {
              short: { year: 'numeric', month: '2-digit', day: '2-digit' },
              long: {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              },
            },
          }}
        >
          <ConfirmDialogProvider>
            <Suspense fallback={<LoadingPage />}>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route index element={<HomePage />} />
                  <Route path="login" element={<LoginPage />} />
                  <Route path="register" element={<RegisterPage />} />
                  <Route path="groups" element={<GroupsPage />} />
                  <Route path="groups/new" element={<NewGroupPage />} />
                  <Route path="groups/:groupId" element={<GroupDetailPage />} />
                  <Route path="groups/:groupId/expenses/new" element={<NewExpensePage />} />
                  <Route
                    path="groups/:groupId/expenses/:expenseId/edit"
                    element={<EditExpensePage />}
                  />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="account/admin/usernames" element={<AdminUsernamesPage />} />
                  <Route path="account/admin/users" element={<AdminUsersPage />} />
                  <Route path="s/:token" element={<SharePage />} />
                  <Route path="404" element={<ErrorPage />} />
                  <Route path="*" element={<Navigate to="/404" replace />} />
                </Route>
              </Routes>
            </Suspense>
            <Toaster position="top-center" richColors closeButton />
          </ConfirmDialogProvider>
        </IntlProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
