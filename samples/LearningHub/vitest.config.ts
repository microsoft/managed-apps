import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts so tests don't start the Managed Apps dev gateway.
export default defineConfig({
  plugins: [react()],
  // Tests use the code defaults, never the developer's own .env.local.
  envDir: false,
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
