import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Storage boundary: browser storage is only touched by the providers in src/storage/core/providers.
const storageGlobals = ['localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
  name,
  message: 'Use the storage interface (src/storage) instead of browser storage.',
}))
const storageProperties = ['localStorage', 'sessionStorage', 'indexedDB'].flatMap((property) =>
  ['window', 'globalThis', 'self'].map((object) => ({
    object,
    property,
    message: 'Use the storage interface (src/storage) instead of browser storage.',
  })),
)
const reservedRoutes = [
  {
    selector: 'Literal[value=/\\/\\.ms\\//]',
    message: 'Platform-reserved /.ms/ routes are not used by this app; go through src/storage or src/connectors.',
  },
  {
    selector: 'TemplateElement[value.raw=/\\/\\.ms\\//]',
    message: 'Platform-reserved /.ms/ routes are not used by this app; go through src/storage or src/connectors.',
  },
]

export default defineConfig([
  globalIgnores(['dist', 'generated', '.ms', 'node_modules', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/storage/core/providers/**'],
    rules: {
      'no-restricted-globals': ['error', ...storageGlobals],
      'no-restricted-properties': ['error', ...storageProperties],
      'no-restricted-syntax': ['error', ...reservedRoutes],
    },
  },
  {
    // Connector codegen is only imported by the app-owned adapters in src/connectors.
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    ignores: ['src/connectors/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/generated', '**/generated/**'],
              message: 'Import connector code only from an adapter in src/connectors.',
            },
            {
              group: ['@microsoft/managed-apps/*'],
              message: 'Call the host SDK only from an adapter in src/connectors.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
  },
])
