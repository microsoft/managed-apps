# Agent guide

CodeFlow is a React + Vite + TypeScript app hosted on Copilot Managed Runtime that reviews GitHub
pull requests through the public GitHub connector. Start with `README.md`.

## Skills

- `.github/skills/setup-codeflow/SKILL.md` — first-time setup (`ms app init`, app settings, GitHub
  connector, `.env.local`).
- `.github/skills/add-data-source/SKILL.md` — move app data from browser storage to a shared backend.

## Rules

- The sample ships without `ms.config.json` and connector code generation (`generated/`, `.ms/`).
  Setup creates them (`npx ms app init`, `npx ms app add data-source`) in the user's copy, which
  is the app's own repository; they are committed there. Only `src/connectors/*` may import
  `generated/`; everything else uses the `GitHubClient` interface.
- Anything the connector has no REST operation for goes through GraphQL
  (`githubClient.graphql`, via `src/services/graphQl.ts`). The operation takes no variables:
  inline values with `gqlString` and treat any GraphQL `errors` entry on a mutation as failure.
- All app-owned data goes through `src/storage` (collections in `src/storage/collections.ts`).
  Don't use `localStorage`, `sessionStorage` or `indexedDB` directly, and never edit
  `src/storage/core/` (it is shared, synced code).
- Don't log payloads, identities or connector responses; use `src/lib/logger.ts`.
- Render external links through `safeUrl` / `githubLink`.
- Keep test data synthetic (`octo-org/octo-repo#123`, `octocat`, `example.com`).

## Checks

```bash
npm run lint
npm test
npm run typecheck   # after setup (needs generated/)
npm run build       # after setup
```
