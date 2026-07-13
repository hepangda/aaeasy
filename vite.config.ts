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
});
