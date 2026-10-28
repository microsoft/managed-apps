---
name: add-database
description: Add an app backend database with `ms app add backend --provider rayfin`. Use only when the user explicitly requests a database, /add-database, or Rayfin, and the CLI reports the rayfin feature as enabled.
user-invocable: true
---

**Shared instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)**

# Add an app backend database

**Required first:** pass the [Rayfin feature gate](../../shared/shared-instructions.md#rayfin-feature-gate).

## 1. Set up the database

If `rayfin/rayfin.yml` exists, use the existing configuration. Otherwise, run:

```bash
ms app add backend --provider rayfin --json
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