import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
  alsoInBottomNav = false,
  hashAliases = {},
}: {
  tabs: TabDefinition[];
  defaultTab?: string;
  /**
   * Set when the mobile bottom nav already offers these same sections. The
   * strip then hides below `lg` (two controls for one hash is confusing) and
   * the newly activated panel is scrolled into view, since the user's tap
   * happened at the bottom of the screen.
   */
  alsoInBottomNav?: boolean;
  /** Legacy URL hashes that should resolve to a current tab id. */
  hashAliases?: Record<string, string>;
}) {
  const idPrefix = useId();
  const fallback = defaultTab ?? tabs[0]?.id ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const rawHashTab = location.hash.replace(/^#/, '');
  const hashTab = hashAliases[rawHashTab] ?? rawHashTab;
  const active = tabs.some((tab) => tab.id === hashTab) ? hashTab : fallback;
  const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));
  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  const panelId = (id: string) => `${idPrefix}-tabpanel-${id}`;

  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Measure after layout, not after paint, so the indicator is never rendered
  // for one frame at a stale position. Re-measured on resize and on label
  // changes (a badge count appearing widens its tab).
  useLayoutEffect(() => {
    function measure() {
      const list = listRef.current;
      const node = tabRefs.current.get(active);
      if (!list || !node) return;
      setIndicator({ left: node.offsetLeft, width: node.offsetWidth });
    }
    measure();

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    if (listRef.current) observer?.observe(listRef.current);
    for (const node of tabRefs.current.values()) observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, tabs]);

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
    <div className="flex flex-col gap-5">
      <div
        ref={listRef}
        role="tablist"
        className={cn(
          'border-border relative -mx-1 gap-0 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          alsoInBottomNav ? 'hidden lg:flex' : 'flex',
        )}
      >
        {/* One indicator that travels, rather than one per tab appearing and
            disappearing. Continuous motion between the old and new position is
            what tells the user these panels sit side by side in a row — a
            hard cut leaves the relationship between them unstated. */}
        <span
          aria-hidden="true"
          className={cn(
            'bg-primary pointer-events-none absolute bottom-0 h-0.5',
            'transition-[transform,width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            'motion-reduce:transition-none',
            indicator ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            width: indicator?.width ?? 0,
            transform: `translateX(${indicator?.left ?? 0}px)`,
          }}
        />
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
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
                'relative flex min-h-11 items-center gap-1.5 px-3 py-2 text-sm font-semibold whitespace-nowrap',
                'transition-colors duration-200',
                isActive ? 'text-primary-ink' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge !== null && (
                <span className="bg-muted text-muted-foreground inline-flex min-w-5 items-center justify-center rounded-md px-1.5 font-mono text-[10px] tabular-nums">
                  {tab.badge}
                </span>
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
