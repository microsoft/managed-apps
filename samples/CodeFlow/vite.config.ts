/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { managedApps } from '@microsoft/managed-apps-vite-plugin';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), managedApps()],
  // Tests use the code defaults, never the developer's own .env.local.
  envDir: process.env.VITEST ? false : undefined,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'tooling',
          environment: 'node',
          include: ['scripts/**/*.test.mjs'],
        },
      },
    ],
  },
});
