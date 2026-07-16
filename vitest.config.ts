import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.ts',
      'packages/contracts/src/**/*.{test,spec}.ts',
      'packages/db/src/**/*.{test,spec}.ts',
      'worker/src/**/*.{test,spec}.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**/*.ts',
        'packages/core/src/**/*.ts',
        'worker/src/auth/access.ts',
        'worker/src/storage/receipts.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
