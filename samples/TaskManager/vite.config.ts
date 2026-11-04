import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { managedApps } from "@microsoft/managed-apps-vite-plugin";
import { defineConfig } from "vite";

// https://vite.dev/config/
// The Managed Apps plugin serves the app config to the local Player and prints the
// "Local Play" URL, so `npm run dev` and `npx ms app dev` work without extra flags.
// Tests use vitest.config.ts, which leaves this plugin out.
export default defineConfig({
  plugins: [react(), tailwindcss(), managedApps()],
  // Relative asset URLs: the deployed app is served under a per-app path.
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
