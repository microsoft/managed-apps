# Development Standards

Standards that apply to all Microsoft Apps skills.

## Theme

- Default to dark theme (`backgroundColor: '#1e1e1e'`, `color: '#fff'`).
- User can override theme preference.

## Node.js

- **Node.js 22+ is required** — `@microsoft/managed-apps-cli` rejects older versions for codegen-bearing commands.
- Check with `node --version` before starting.
- If the user has multiple versions, suggest `nvm use 22`.

## CLI Install

- **Install `@microsoft/managed-apps-cli` globally**, never per-workspace, so the `ms` binary is on PATH and the per-app workspace stays clean.
- Install command:
  ```bash
  npm install -g @microsoft/managed-apps-cli@latest
  ```
- The CLI is published on the public npm registry: https://www.npmjs.com/package/@microsoft/managed-apps-cli
- Pin to the `@latest` tag and re-check on each skill invocation — the `@latest` tag updates regularly.
- After install, probe the binary name (`ms` (single supported binary)).

## Build & Deploy

- **Default loop is `ms app dev`**, not deploy. Microsoft Apps run locally against the App Player with hot reload; deploy only when the user asks.
- When the user does want to ship:
  - Local-built (primary): `npm run build`, then `git add -A && git commit && git push`, then `ms app deploy`.
  - Cloud-built: `git add -A && git commit && git push`, then `ms app deploy [--commit <sha>]`.
- **Always** run `npm run build` before `ms app deploy` — never skip the build.
- **Always** deploy from a pushed commit — never deploy uncommitted or unpushed local changes.
- Verify the build output directory (`./dist` by default, or whatever `--build-path` resolves to) is populated before deploy.
- When adding multiple data sources: do NOT push after each one. Run `npm run build` to verify, then deploy once at the end (or skip and rely on local dev).

## TypeScript

- The template uses strict mode — unused imports cause build failures (TS6133).
- Remove any imports you don't use before building.
- Don't edit generated codegen output in `generated/` (the layout is owned by `@microsoft/apps-actions`).