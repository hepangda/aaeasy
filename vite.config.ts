import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      config:
        process.env.CLOUDFLARE_REMOTE_BROWSER === 'true'
          ? { browser: { binding: 'BROWSER', remote: true } }
          : undefined,
    }),
  ],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(import.meta.dirname, 'src') }],
  },
  server: {
    // Vite ignores PORT by default. Honoring it lets a second dev server pick a
    // free port instead of colliding with one already running on the default.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
});
