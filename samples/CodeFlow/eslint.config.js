import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/** Browser storage must go through `src/storage` (see `.github/skills/add-data-source`). */
const storageGlobals = ['localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
  name,
  message: 'Use the storage layer in src/storage instead of browser storage directly.',
}))

/** Platform-internal routes are not part of the public app surface. */
const internalRouteSyntax = {
  selector: 'Literal[value=/\\/\\.ms\\//], TemplateElement[value.raw=/\\/\\.ms\\//]',
  message: 'Do not call platform-internal /.ms/ routes. Persist data through src/storage.',
}

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
      // Honour the `_name` convention for deliberately-unused bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/storage/core/providers/**'],
    rules: {
      'no-restricted-globals': ['error', ...storageGlobals],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/storage/core/providers/**', 'src/storage/providers/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...storageGlobals.map(({ name, message }) => ({ object: 'window', property: name, message })),
        ...storageGlobals.map(({ name, message }) => ({ object: 'globalThis', property: name, message })),
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/storage/core/providers/**'],
    rules: {
      'no-restricted-syntax': ['error', internalRouteSyntax],
    },
  },
  {
    // Connector code generation is only ever imported through the adapters.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/connectors/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)generated(/|$)',
              message: 'Import connector code through src/connectors/* instead of generated/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
])
