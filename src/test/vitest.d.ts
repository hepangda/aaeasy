import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// `src/test/setup.ts` calls expect.extend() with jest-dom's matchers at runtime.
// This teaches TypeScript about them so component tests typecheck.
declare module 'vitest' {
  // The empty body is the point: this is declaration merging, not a new type.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T = unknown> extends TestingLibraryMatchers<T, void> {}
}
