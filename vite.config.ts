import { readFileSync, rmSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// While developing, account and bug report calls go to the Laravel backend (`npm run dev:api`).
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:8000';

/** public/api held the old PHP bug report endpoint; a leftover settings file there must not ship. */
const dropOldApi = (): Plugin => ({
  name: 'drop-old-api',
  apply: 'build',
  closeBundle() {
    rmSync(new URL('./dist/api', import.meta.url), { recursive: true, force: true });
  },
});

// Relative base so the build works from any folder or subdomain on shared hosting.
export default defineConfig({
  base: './',
  plugins: [react(), dropOldApi()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2020' },
  server: {
    proxy: {
      '/api': { target: API_TARGET },
      '/sanctum': { target: API_TARGET },
      '/auth': { target: API_TARGET },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
} as any);
