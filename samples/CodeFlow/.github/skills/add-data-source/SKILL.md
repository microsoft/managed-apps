---
name: add-data-source
description: Moves this app's data from browser-local storage to a shared backend (SharePoint lists, Dataverse tables, a REST API, or any other store) by adding a storage provider. Use when the user wants app data shared between people or devices, kept outside the browser, or stored in a specific system.
---

# Add a data source

Every read and write of app-owned data in this template goes through one storage interface
(`src/storage/core/types.ts`). By default the `local` provider keeps data in the browser
(`localStorage`). This skill adds another provider and switches the app to it **without
changing UI or domain code**.

## Ground rules

- **Never edit `src/storage/core/`.** It is shared, tested code. Build on it.
- **Never change UI, hooks or domain modules** to make a backend work. If the interface seems
  insufficient, stop and explain the gap to the user.
- Generated connector code is imported **only** from `src/connectors/` (an ESLint rule enforces
  this). The provider in `src/storage/providers/` depends on that thin wrapper, not on
  `generated/` directly, so it can be tested with fakes.
- A provider is finished when `runProviderContract()` passes against it (step 6).
- Authorization belongs to the backend. Configure list/table permissions; never rely on hiding
  UI (step 7).

## Step 1: Understand what is stored

1. Read `src/storage/collections.ts`. Every collection is a zod schema plus a name.
2. Run `npm run storage:describe`. It prints each collection as JSON Schema; you will create one
   list/table per collection.
3. Note which data uses `provider.kv(...)` (preferences, drafts, UI state). These usually stay
   **device-local**, which is the default described in step 5.
4. Ask the user which collections should move (usually all of them) and who should be able to
   read and write each one.

## Step 2: Choose the backend

| Backend | Good for | Needs | Reference |
|---|---|---|---|
| **SharePoint lists** | Teams that already use SharePoint; simple setup | A SharePoint site where the user can create lists | `references/sharepoint.md` |
| **Dataverse tables** | Relational/business data; role-based security; large volumes | A Power Platform environment with Dataverse, and the matching licenses | `references/dataverse.md` |
| **Your own API** | Existing systems or databases | A connector (or custom connector) that exposes CRUD operations | `references/custom-api.md` |

If the user has no preference, recommend SharePoint lists for small teams and Dataverse for
anything with roles, auditing or large data.

## Step 3: Provision the backing store

Use the **document-in-a-row** layout for every collection. It maps any record shape onto any
tabular store and keeps the provider generic:

| Column | Type | Purpose |
|---|---|---|
| `RecordKey` | Single line of text, **indexed, unique, required** | Record id (`BackendRow.key`) |
| `Data` | Multiple lines of **plain** text (no rich text, no length cap below ~1 MB) | The record body as JSON |
| *(built-in)* ETag / row version | backend-managed | `BackendRow.etag` |
| *(built-in)* Created / Modified | backend-managed | `createdAt` / `updatedAt` |

Name each list/table after the collection, optionally with an app prefix, e.g. `LearningHub_sessions`.
You *may* add extra "promoted" columns for fields you want to search in the backend UI, but the
app reads only `RecordKey` and `Data`.

Create the lists/tables yourself only if the user asks and has permission. Otherwise give them
the exact list of names and columns.

## Step 4: Add the connector

Always use the CLI (pinned in `package.json`) so codegen and `ms.config.json` stay consistent. Run
`npx ms app add data-source --help` to see every flag.

```bash
# SharePoint: one command per list
npx ms app add data-source --connector shared_sharepointonline --as table --dataset "<site URL>" --table "<list name>"

# Dataverse: one command per table (no connection id needed)
npx ms app add data-source --connector dataverse --as table --table "<table logical name>"

# Any other connector
npx ms connector list --search "<keyword>"
npx ms app add data-source --connector <api-id> --as action
```

Then find the generated operations. **Do not read whole generated files**; they are large:

```bash
# list method names of a generated service
rg "async \w+\(" generated/services/<Name>Service.ts
# then read one method and its model
rg "async <MethodName>" -A 25 generated/services/<Name>Service.ts
```

## Step 5: Implement the provider

The core already provides `createTableBackedProvider()`. You implement **one `TableBackend` per
collection**, which is five methods. Everything else (validation, queries, paging, conflicts,
export/import) is handled for you.

1. **Connector wrapper**: `src/connectors/<backend>Tables.ts`. This is the only file that imports
   `generated/`. Expose plain functions such as `listRows(table, cursor)`, `getRow`,
   `createRow`, `updateRow(table, key, data, etag)` and `deleteRow`, and translate connector
   results into `BackendRow` (`{ key, data, etag, createdAt, updatedAt }`).
2. **Provider**: `src/storage/providers/<backend>.ts`.

```ts
// Adjust names (config fields, table prefix) to match this app's src/config.ts.
import { createLocalProvider, createTableBackedProvider, type TableBackend } from '../core';
import * as rows from '../../connectors/sharepointTables';
import { config } from '../../config';

function backendFor(collectionName: string): TableBackend {
  const table = `${config.storageTablePrefix}${collectionName}`;
  return {
    list: (cursor) => rows.listRows(table, cursor),
    get: (key) => rows.getRow(table, key),
    create: (key, data) => rows.createRow(table, key, data),     // ConflictError if key exists
    update: (key, data, etag) => rows.updateRow(table, key, data, etag), // ConflictError on etag mismatch, NotFoundError if missing
    delete: (key, etag) => rows.deleteRow(table, key, etag),     // idempotent; ConflictError on etag mismatch
  };
}

export function createSharePointProvider() {
  const local = createLocalProvider({ prefix: config.storagePrefix });
  return createTableBackedProvider({
    id: 'sharepoint',
    shared: true,
    tableFor: backendFor,
    kv: (namespace) => local.kv(namespace), // keep preferences on the device
  });
}
```

3. **Register it** in `src/storage/index.ts` by adding `sharepoint: createSharePointProvider` to
   the provider registry. Then set `VITE_STORAGE_PROVIDER=sharepoint` (plus any new variables,
   such as the table prefix) in `.env.local`. Document the new variables in `.env.example` and in `src/config.ts`.
4. Remote stores do not push changes. Call `provider.refresh()` on window focus, and optionally
   on a timer, so other users' edits appear.

### Mapping rules every backend must follow

- `etag` must change on **every** write, and the backend must reject stale etags with a
  "precondition failed" error (HTTP 412). Map that error to `ConflictError` from `../core`.
- `create` with an existing key must throw `ConflictError`. Enforce uniqueness on `RecordKey`,
  or check first.
- A missing record on `update` throws `NotFoundError`. `delete` of a missing record succeeds.
- `list` must page with the backend's continuation token. Never assume one page holds everything.
- Store `Data` exactly as given. Never reformat the JSON.

## Step 6: Prove it with the contract suite

Create `src/storage/providers/<backend>.test.ts`:

```ts
import { runProviderContract } from '../core/contract';
// Fake the connector wrapper (src/connectors/<backend>Tables.ts) with an in-memory map that
// reproduces the backend's real behaviour: etags, 412s, paging. See createInMemoryTableBackend
// in core/providers/tableBacked.ts for the reference behaviour.
runProviderContract('sharepoint', () => createSharePointProviderWithFakeRows());
```

Run `npm test`, `npm run lint` and `npm run typecheck`. All must pass. Then run the app against the
real backend and try each feature, ideally in two browsers with different accounts to see
sharing and conflicts.

## Step 7: Security and privacy

- Grant list/table permissions to exactly the people who should read or write each collection.
  The app's UI is not a security boundary.
- Review what becomes visible once data is shared. Collections that were per-browser (drafts,
  personal notes) may now be readable by others; keep those in `kv` (device-local), or use a
  per-user table with item-level permissions.
- Keep connector permissions least-privilege. Add only the tables the app uses.

## Step 8: Move existing data

Users can move what they already have: in the app's Settings, choose **Export data** while still
on the `local` provider, switch to the new provider, then **Import data**. Import validates every
record and skips anything invalid.

## Done checklist

- [ ] One list/table per moved collection, with `RecordKey` (unique) and `Data` columns
- [ ] Connector added with the CLI; the updated `generated/`, `.ms/` and `ms.config.json` are committed to the app's repository.
- [ ] `src/connectors/<backend>Tables.ts` plus `src/storage/providers/<backend>.ts`, registered in `src/storage/index.ts`
- [ ] The contract suite passes for the new provider, and `npm test`, `npm run lint` and `npm run typecheck` are green
- [ ] Permissions configured in the backend
- [ ] `.env.example`, `src/config.ts` and the README's "Storage" section updated
