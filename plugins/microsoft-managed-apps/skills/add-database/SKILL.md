---
name: add-database
description: Add an app backend database with `ms app add rayfin`. Use when the user requests Rayfin and the rayfin feature (MS_CLI_FEATURE_RAYFIN) is enabled.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion
model: sonnet
---

**Shared instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)**

# Add an app backend database

**Required first:** pass the [Rayfin feature gate](../../shared/shared-instructions.md#rayfin-feature-gate)
for `MS_CLI_FEATURE_RAYFIN`. If it is disabled or cannot be verified, stop without
enabling it automatically.

## 1. Set up the database

From the app root, check for `ms.config.json` and `package.json`.
If `rayfin/rayfin.yml` exists, use the existing configuration. Otherwise, run:

```bash
ms app add rayfin --json
```

This creates the backend configuration, TypeScript configuration and `rayfin/data/`,
and declares the runtime client dependency. Keep the existing app layout and
exclude `rayfin/.temp/` from version control.

## 2. Install dependencies

Run from the app root before continuing so the declared dependencies and their
version-matched docs are available in `node_modules`:

```bash
npm install
```

Use the app's existing package manager and lockfile if it does not use npm.
Report installation or peer-dependency errors; do not force-install or downgrade
the app to bypass them. Add missing direct dependencies only as required by the
implementation described in the references.

## 3. Implement and check the app

Read the installed package docs identified in these references, then follow them
in order:

- [Data modeling](./references/rayfin-data-modeling.md): entities, permissions and runtime client.
- [CRUD UI](./references/rayfin-crud-ui.md): lists, forms, mutations and persistence checks.

When called from `/create-app`, complete setup and modeling, then return the
entity/client paths and any blocked prerequisites. The caller follows the CRUD
UI reference during implementation.

After implementation, run the app's build command (`npm run build` for npm apps).
When called from `/create-app`, leave that build to its post-implementation step.
Use the shared [app build and deploy workflow](../../shared/development-standards.md#build--deploy)
and its approval gates; do not add a separate database lifecycle.
