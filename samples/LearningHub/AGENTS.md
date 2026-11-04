# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

Learning Hub is a React 19 + Vite + TypeScript app for a recurring learning series: past sessions,
sign-ups for upcoming dates, and topic requests with votes. It is hosted on Copilot Managed Runtime
(`@microsoft/managed-apps` packages, `ms` CLI) and uses the Office 365 Users connector for people.

## Layout

| Path | What lives there |
|---|---|
| `src/pages/` | One component per route (`Home`, `Present`, `Topics`, `SessionDetail`, `Person`, `Settings`). |
| `src/components/` | Presentational pieces (cards, dialogs, pickers). No storage or connector calls. |
| `src/lib/` | Domain logic and hooks: `sessions.ts`, `topics.ts`, `pastSessions.ts`, `sampleData.ts`, optimistic writes (`*Actions.ts`), `router.ts` (hash routes and deep links), `share.ts`, `time.ts`, `logger.ts`, `safeUrl.ts`. |
| `src/storage/` | `collections.ts` (zod schemas, the source of truth for stored data), `index.ts` (provider registry and `createStorage()`), `edit.ts` (conflict-safe read-modify-write). |
| `src/storage/core/` | Shared storage core, synced from upstream. **Do not edit.** |
| `src/connectors/` | App-owned adapters: `users.ts` (directory interface) with `office365Users.ts`, and `host.ts` with `managedAppsHost.ts`. The only code allowed to import `generated/` or `@microsoft/managed-apps/*`. |
| `src/config.ts` | Typed `VITE_*` configuration with defaults; documented in `.env.example`. |
| `scripts/` | `check-setup.mjs` (runs before dev/build) and `storage-describe.ts`. |

## Rules

- **Storage boundary.** Read and write data only through `src/storage` (collections and key/value
  stores from `useAppStorage()` or an `AppStorage` passed in). Never use `localStorage`,
  `sessionStorage` or `indexedDB` directly; ESLint enforces this outside
  `src/storage/core/providers/`.
- **Connector boundary.** Only `src/connectors/*` imports `generated/`. Everything else depends on
  the adapter interface (`UsersDirectory` in `src/connectors/users.ts`) so tests can use
  `createFakeUsersDirectory()`. `generated/` and `.ms/` are created by the setup skill and
  committed to the user's own app repository, never to this sample.
- **People are stored by directory user id**, never by email.
- **Links** from data or connectors go through `safeUrl()`.
- **No authorization in the browser.** With local storage the user owns their data. Shared backends
  enforce permissions server-side (see the add-data-source skill).
- **Logging** goes through `src/lib/logger.ts` (no-op in production); never log payloads or identities.
- Keep domain logic in `src/lib` testable with `createMemoryProvider()`; add tests in `src/test/`.

## Skills

- `.github/skills/setup-learninghub/SKILL.md`: first-time setup (`ms auth login`, `ms app init` to create
  `ms.config.json`, `ms app set-setting --show-header false`, add the Office 365 Users connector,
  `.env.local`, `check-setup`). The sample ships without `ms.config.json`.
- `.github/skills/add-data-source/SKILL.md`: move storage from the browser to SharePoint,
  Dataverse or a custom API.

Both are mirrored under `.claude/skills/`.

## Commands

```sh
npm install
npm test                  # vitest; works without generated/
npm run lint              # eslint; works without generated/
npm run typecheck         # tsc -b; needs generated/ (setup skill)
npm run check-setup       # verifies ms.config.json (from `npx ms app init`) and generated connector code
npm run dev               # vite dev server (via `npx ms app dev` for the hosted player)
npm run build             # check-setup + typecheck + vite build
npm run storage:describe  # JSON Schema for every collection
```
