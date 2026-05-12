'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface TabDefinition {
  id: string;
  label: React.ReactNode;
  /** Optional small badge after the label, e.g. a count. */
  badge?: React.ReactNode;
  /** The panel body. Rendered eagerly for every tab; visibility toggled via display:none. */
  content: React.ReactNode;
}

/**
 * Lightweight tab shell — purely presentational. Lives client-side because
 * we want instant tab switching without round-trips. Persists the active tab
 * in the URL hash so reloads + sharable links keep their place.
 *
 * Every panel renders eagerly; we toggle visibility with `hidden` rather
 * than mounting/unmounting. This:
 *   - keeps per-panel state (form values, scroll, popover open) alive
 *   - avoids passing a render-prop child across the RSC/client boundary
 *     (which Next.js can't serialize)
 */
export function Tabs({
  tabs,
  defaultTab,
}: {
  tabs: TabDefinition[];
  defaultTab?: string;
}) {
  const fallback = defaultTab ?? tabs[0]?.id ?? '';
  const [active, setActive] = useState(fallback);

  // Read initial tab from URL hash on mount; keep in sync if the user uses
  // back/forward.
  useEffect(() => {
    function read() {
      if (typeof window === 'undefined') return;
      const hash = window.location.hash.replace(/^#/, '');
      if (hash && tabs.some((t) => t.id === hash)) setActive(hash);
    }
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [tabs]);

  function activate(id: string) {
    setActive(id);
    if (typeof window !== 'undefined') {
      // Replace, don't push, so the back button still goes to the previous
      // page rather than walking through every tab.
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState(null, '', url.toString());
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        className="border-border/60 -mx-1 flex gap-1 overflow-x-auto border-b"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => activate(tab.id)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge !== null && (
                <span className="bg-muted text-muted-foreground inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums">
                  {tab.badge}
                </span>
              )}
              {isActive && (
                <span
                  aria-hidden
                  className="bg-foreground absolute -bottom-px left-0 h-0.5 w-full"
                />
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`tabpanel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== active}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
