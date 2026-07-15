import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { cn } from '@/lib/utils';

export interface TabDefinition {
  id: string;
  label: React.ReactNode;
  /** Optional small badge after the label, e.g. a count. */
  badge?: React.ReactNode;
  /** The panel body. It mounts when first visited and then keeps its local state. */
  content: React.ReactNode;
}

/**
 * Lightweight tab shell — purely presentational. Lives client-side because
 * we want instant tab switching without round-trips. Persists the active tab
 * in the URL hash so reloads + sharable links keep their place.
 *
 * Panels mount on first visit and remain mounted, so initial work stays small
 * while in-progress form state survives a tab switch.
 */
export function Tabs({
  tabs,
  defaultTab,
  hideTabListOnMobile = false,
}: {
  tabs: TabDefinition[];
  defaultTab?: string;
  hideTabListOnMobile?: boolean;
}) {
  const idPrefix = useId();
  const fallback = defaultTab ?? tabs[0]?.id ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const hashTab = location.hash.replace(/^#/, '');
  const active = tabs.some((tab) => tab.id === hashTab) ? hashTab : fallback;
  const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));
  const previousActive = useRef(active);
  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  const panelId = (id: string) => `${idPrefix}-tabpanel-${id}`;

  // Keep one source of truth for desktop tabs, mobile navigation, reloads,
  // and browser history. Normalizing the default into the URL also lets
  // navigation outside this component highlight the correct panel.
  useEffect(() => {
    if (!active || location.hash === `#${active}`) return;
    void navigate(
      { pathname: location.pathname, search: location.search, hash: `#${active}` },
      { replace: true, preventScrollReset: true },
    );
  }, [active, location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    setVisited((current) => {
      if (current.has(active)) return current;
      const next = new Set(current);
      next.add(active);
      return next;
    });
  }, [active]);

  useEffect(() => {
    const changed = previousActive.current !== active;
    previousActive.current = active;
    if (!changed || !hideTabListOnMobile || !window.matchMedia('(max-width: 639px)').matches) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}-tabpanel-${active}`)?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, hideTabListOnMobile, idPrefix]);

  function activate(id: string) {
    void navigate(
      { pathname: location.pathname, search: location.search, hash: `#${id}` },
      { replace: true, preventScrollReset: true },
    );
  }

  function moveFocus(currentId: string, key: string) {
    const currentIndex = tabs.findIndex((tab) => tab.id === currentId);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (key === 'Home') nextIndex = 0;
    if (key === 'End') nextIndex = tabs.length - 1;
    const nextId = tabs[nextIndex]?.id;
    if (!nextId || nextId === currentId) return;
    activate(nextId);
    document.getElementById(tabId(nextId))?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        className={cn(
          'border-border/60 -mx-1 gap-1 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          hideTabListOnMobile ? 'hidden sm:flex' : 'flex',
        )}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId(tab.id)}
              id={tabId(tab.id)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => activate(tab.id)}
              onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                moveFocus(tab.id, event.key);
              }}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
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
      {tabs
        .filter((tab) => tab.id === active || visited.has(tab.id))
        .map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={panelId(tab.id)}
            aria-labelledby={tabId(tab.id)}
            tabIndex={tab.id === active ? 0 : undefined}
            hidden={tab.id !== active}
            className="scroll-mt-20"
          >
            {tab.content}
          </div>
        ))}
    </div>
  );
}
