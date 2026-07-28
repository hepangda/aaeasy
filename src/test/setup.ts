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
