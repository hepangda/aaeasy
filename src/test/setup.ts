import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// jest-dom's matchers (toBeInTheDocument, toHaveClass, ...) are framework
// agnostic; wire them into vitest's expect. Harmless for the node-environment
// suites, which simply never call them.
expect.extend(matchers);

// Component tests render into a shared document. Without this, each test would
// stack another tree onto document.body and queries would match duplicates.
afterEach(() => {
  cleanup();
});

// This vitest build's jsdom environment ships without Storage. ThemeProvider
// reads localStorage during its initial render, so anything that mounts the app
// shell needs it present.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

// jsdom implements no media queries. Components that branch on viewport or
// colour-scheme need a stub that simply reports "no match".
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
