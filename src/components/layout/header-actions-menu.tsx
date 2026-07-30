import Link from '@/router/link';
import { useTransition } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Check, Languages, Laptop, LogIn, LogOut, Menu, Moon, Sun, User } from 'lucide-react';
import { logoutAction } from '@/spa/actions/auth';
import { setLocaleAction } from '@/spa/actions/locale';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/layout/theme-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
] as const;

const THEMES = [
  { code: 'light', labelKey: 'theme_light', Icon: Sun },
  { code: 'dark', labelKey: 'theme_dark', Icon: Moon },
  { code: 'system', labelKey: 'theme_system', Icon: Laptop },
] as const;

export function HeaderActionsMenu({ userDisplayName }: { userDisplayName?: string }) {
  const locale = useLocale();
  const common = useTranslations('common');
  const account = useTranslations('account');
  const { setTheme, theme } = useTheme();
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={common('actions')}>
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <Languages className="size-4" />
            {common('language')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value) =>
              startTransition(() => setLocaleAction(value === 'en' ? 'en' : 'zh'))
            }
          >
            {LANGS.map((lang) => (
              <DropdownMenuRadioItem
                key={lang.code}
                value={lang.code}
                disabled={isPending}
                className="justify-between"
              >
                {lang.label}
                {locale === lang.code && <Check className="size-4" />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <Sun className="size-4" />
            {common('theme')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) =>
              setTheme(value === 'light' || value === 'dark' ? value : 'system')
            }
          >
            {THEMES.map(({ code, labelKey, Icon }) => (
              <DropdownMenuRadioItem key={code} value={code} className="justify-between">
                <span className="flex items-center gap-2">
                  <Icon className="size-4" />
                  {common(labelKey)}
                </span>
                {theme === code && <Check className="size-4" />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {userDisplayName ? (
            <>
              <DropdownMenuItem asChild>
                <Link href="/account" className="gap-2">
                  <User className="size-4" />
                  <span className="truncate">{account('title')}</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isPending}
                onSelect={() => startTransition(() => logoutAction())}
                className="text-destructive-ink focus:text-destructive-ink gap-2"
              >
                <LogOut className="size-4" />
                {common('logout')}
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem asChild>
              <Link href="/login" className="gap-2">
                <LogIn className="size-4" />
                {common('login')}
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
