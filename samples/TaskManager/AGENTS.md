# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

Task Manager: a React 19 + Vite + TypeScript sample app hosted on Copilot Managed Runtime (Windows 95 styling, shadcn/ui,
Tailwind v4, TanStack Query). Work items come from Azure DevOps; the app's own data goes through
the storage interface. See README.md for features and configuration.

## Structure

- `src/pages/home.tsx` — thin shell only. Put tab UI in `src/features/<tab>/`.
- `src/lib/` — domain logic (Azure DevOps queries and writes, trackers, tags, retro, notes, feedback).
- `src/connectors/` — adapters over the generated connector clients. **Only these files may import
  `generated/`** (ESLint enforces it). Everything else calls `connectors()` from `src/connectors`.
- `src/storage/` — `core/` is shared code synced from elsewhere: **never edit it**.
  `collections.ts` defines this app's collections (zod), `index.ts` the provider registry.
- `src/config.ts` — the only place that reads `import.meta.env`.

## Rules

- All app-owned data goes through `src/storage` (collections or `provider.kv(...)`). Never use
  `localStorage`, `sessionStorage` or `indexedDB` directly (ESLint enforces it).
- Use `withConflictRetry` + `ifVersion` for read-modify-write updates.
- The only role concept is `admins.json` (root), read by `src/lib/admins.ts` (`useIsAdmin`) to hide the
  admin tabs listed in `ADMIN_TABS` (`src/hooks/use-app-tab.ts`). It is a UI convenience, not
  security: Azure DevOps and the storage backend authorize writes. Don't add other role checks.
- Route every external or user-entered link through `safeUrl()`; render HTML only via `SafeRichText`.
- Log with `src/lib/logger.ts` (no-op in production); never log payloads or identities.
- `generated/` and `.ms/` are produced by `npx ms app add data-source` in the user's copy and committed to their own app repository, never to this sample.

## Skills

- `.github/skills/setup-taskmanager/` — first-time setup (app creation, connectors, `.env.local`).
- `.github/skills/add-data-source/` — move app data to SharePoint, Dataverse or another backend.

## Commands

```bash
npm test             # unit tests (no setup needed)
npm run lint         # includes storage/connector boundary rules
npm run typecheck    # requires generated/ (after setup)
npm run check-setup  # verifies ms.config.json and generated connector services
npm run dev          # dev server (runs check-setup first)
```
