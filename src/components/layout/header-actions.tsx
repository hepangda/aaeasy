import Link from '@/router/link';
import { useTransition } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Check, Languages, Laptop, LogOut, Moon, Sun, User } from 'lucide-react';
import { logoutAction } from '@/spa/actions/auth';
import { setLocaleAction } from '@/spa/actions/locale';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/layout/theme-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
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

/** Language switcher — one icon, opens the locale list. */
function LanguageMenu() {
  const locale = useLocale();
  const common = useTranslations('common');
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={common('language')}>
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Theme switcher — one icon. The trigger shows the theme actually in effect,
 * so under `system` it tracks the resolved light/dark rather than showing a
 * laptop glyph that says nothing about what the user is looking at.
 */
function ThemeMenu() {
  const common = useTranslations('common');
  const { resolvedTheme, setTheme, theme } = useTheme();
  const TriggerIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={common('theme')}>
          <TriggerIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Account control. Signed out it is a labelled link — "log in" is the one
 * action a new visitor must not have to hunt for behind a glyph. Signed in it
 * collapses to the avatar initial, which opens account settings / sign out.
 */
function AccountControl({ displayName }: { displayName?: string }) {
  const common = useTranslations('common');
  const account = useTranslations('account');
  const [isPending, startTransition] = useTransition();

  if (!displayName) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href="/login">{common('login')}</Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={common('account')}>
          <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-full font-mono text-xs font-bold">
            {displayName.trim().charAt(0).toUpperCase() || 'A'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The top-right cluster: language, theme and account, each its own control.
 * These were previously buried together under a single hamburger, which cost
 * two clicks to reach a setting and hid the sign-in entry point entirely.
 */
export function HeaderActions({ userDisplayName }: { userDisplayName?: string }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <LanguageMenu />
      <ThemeMenu />
      <AccountControl displayName={userDisplayName} />
    </div>
  );
}
