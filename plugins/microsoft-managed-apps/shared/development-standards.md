# Development Standards

Standards that apply to all managed apps skills.

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
- Pin to the `@latest` tag.
- After install, probe the binary name (`ms` (single supported binary)).

### CLI freshness gate

Run this gate once at the start of every skill invocation, before the first operational `ms` command. The `ms --version` probe is part of the gate:

1. Read the installed version with `ms --version`.
2. Read the latest stable version with `npm view @microsoft/managed-apps-cli@latest version`.
3. Compare the versions using semver rules. Do not treat an installed version newer than `@latest` as outdated.
4. If `@latest` is newer, tell the user both versions and ask: _"`@microsoft/managed-apps-cli` {installed} is installed, but {latest} is available. Update the global CLI before proceeding?"_ Wait for the answer.
   - If approved, run `npm install -g @microsoft/managed-apps-cli@latest`, then verify `ms --version` reports the expected version before continuing.
   - If declined, acknowledge the choice and continue with the installed version.
5. If the registry lookup fails, report that the latest version could not be checked and continue with the installed CLI. Do not silently claim it is current.

The upgrade prompt satisfies the global-install confirmation requirement; do not ask for a second confirmation.

## Build & Deploy

- **Default loop is `ms app dev`**, not deploy. Managed apps run locally against the App Player with hot reload; deploy only when the user asks.
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