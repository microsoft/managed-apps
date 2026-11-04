import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Flat config (ESLint 9) for a Vite + React + TypeScript app.
// `generated/` (connector codegen) and `.ms/` are produced locally by the CLI
// and are never linted or committed.
const STORAGE_PROVIDERS = "src/storage/core/providers/**";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "generated", ".ms", ".vite-cache", "*.timestamp-*.mjs"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/generated", "**/generated/**"],
              message:
                "Import connector code only from the adapters in src/connectors/ (they are the only modules allowed to use generated/).",
            },
            {
              group: ["framer-motion"],
              message: "Use `motion/react` instead.",
            },
            {
              group: ["@radix-ui/react-*"],
              message: "Import Radix primitives from the unified `radix-ui` package or the `@/components/ui/*` wrappers.",
            },
          ],
        },
      ],
    },
  },
  {
    // Storage boundary: browser storage and app-data routes are reachable only
    // through the storage providers in src/storage/core/providers.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [STORAGE_PROVIDERS],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "Use the storage interface (src/storage) instead." },
        { name: "sessionStorage", message: "Use the storage interface (src/storage) instead." },
        { name: "indexedDB", message: "Use the storage interface (src/storage) instead." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "localStorage", message: "Use the storage interface (src/storage) instead." },
        { object: "window", property: "sessionStorage", message: "Use the storage interface (src/storage) instead." },
        { object: "window", property: "indexedDB", message: "Use the storage interface (src/storage) instead." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\/\\.ms\\//]",
          message: "App data must go through the storage interface (src/storage), not platform routes.",
        },
        {
          selector: "TemplateElement[value.raw=/\\/\\.ms\\//]",
          message: "App data must go through the storage interface (src/storage), not platform routes.",
        },
      ],
    },
  },
  {
    // Connector adapters are the only modules allowed to import generated/.
    files: ["src/connectors/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // shadcn/ui components co-export a component plus its `cva` variants.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Node scripts and config files.
    files: ["scripts/**/*.{js,mjs,ts}", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
