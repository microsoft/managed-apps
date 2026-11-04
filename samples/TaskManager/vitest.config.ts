import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests stay independent of the dev server setup.
export default defineConfig({
  plugins: [react()],
  // Tests use the code defaults, never the developer's own .env.local.
  envDir: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 30_000,
  },
});
