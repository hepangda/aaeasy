import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Default stays `node` for the pure-logic suites. Component tests opt into
    // jsdom with a `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'packages/contracts/src/**/*.{test,spec}.ts',
      'packages/db/src/**/*.{test,spec}.ts',
      'worker/src/**/*.{test,spec}.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'packages/core/src/**/*.ts', 'worker/src/auth/access.ts'],
      reporter: ['text', 'html'],
    },
  },
});
