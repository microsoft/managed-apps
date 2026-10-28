# Data modeling

Reference for [/add-backend](../SKILL.md). Pass the
[Rayfin feature gate](../../../shared/shared-instructions.md#rayfin-feature-gate)
before using this guidance.

## Read the docs first

Rayfin's data rules belong to the installed packages. Read decorators, permissions, query APIs and
platform constraints from disk. Paths are relative to the app root.
Complete the entry skill's `npm install` step first.

For each package, read `node_modules/@microsoft/<package>/package.json`, follow
`rayfinDocs.dir`, and start with `index.md`. Then read only the relevant pages.
Current package-doc locations:

| Topic | Installed documentation |
| --- | --- |
| Entities, fields and relationships | `node_modules/@microsoft/rayfin-core/assets/docs/decorators.md` |
| Permissions, owner stamping and authentication shorthands | `node_modules/@microsoft/rayfin-core/assets/docs/permissions.md` |
| Paging, cursors and text-field nullability | `node_modules/@microsoft/rayfin-data/assets/docs/index.md` |
| Client entry point | `node_modules/@microsoft/rayfin-client/assets/docs/index.md` |
| Auth entry point | `node_modules/@microsoft/rayfin-auth/assets/docs/index.md` |
| Fabric runtime sign-in, when used | `node_modules/@microsoft/rayfin-auth-provider-fabric/assets/docs/index.md` |

If `@microsoft/rayfin-guide` is already installed, also use these walkthroughs:

| Topic | Installed documentation |
| --- | --- |
| Entity authoring and relationships | `node_modules/@microsoft/rayfin-guide/assets/docs/data/overview.md` |
| Policies, claims and field visibility | `node_modules/@microsoft/rayfin-guide/assets/docs/data/permissions.md` |
| Queries, mutations and relationship writes | `node_modules/@microsoft/rayfin-guide/assets/docs/data/graphql.md` |
| Platform constraints | `node_modules/@microsoft/rayfin-guide/assets/docs/known-limitations.md` |

Read `known-limitations.md` before designing entities when available. For
service-specific authentication, read the relevant pages under the guide's
`assets/docs/auth/` directory.

Some client/auth indexes are stubs. Follow the installed package's `types` or
`exports` entry to its declarations for missing API signatures. If the installed
docs and declarations do not establish the required behavior, report the gap
rather than guessing. Do not install the Rayfin CLI or guide just to read docs.

## Step 1: Turn the data service on

Reuse `rayfin/rayfin.yml` and the installed dependencies from Steps 1-2 of
[/add-backend](../SKILL.md). If setup is missing, complete only those steps.
Keep the existing managed app layout, authentication and transport boundary.

Declare `@microsoft/rayfin-core` directly when entity code imports it. The client
brings core, data and auth transitively, but not `rayfin-auth-provider-fabric` or
`rayfin-guide`. Add the Fabric provider only if the runtime sign-in implementation
needs it. Match direct SDK dependencies to the installed client version and rerun
the app's package-manager install after changing its manifest.

## Step 2: Write entity files

Write one named exported entity class per file in `rayfin/data/`, following the
installed decorator, permissions and platform-limit docs. Re-export nested
entities from a top-level file.

Keep the scaffold's NodeNext build wiring and `.js` extensions for backend
imports. Read field options, relationship syntax and constraints from the docs
above rather than copying a fixed set of SDK rules.

## Step 3: Map entities into the client schema

App packaging discovers the named entity exports; no runtime registry is required.
Maintain a type map for the entities used by the client, for example:

```typescript
// rayfin/data/schema.ts
import type { Todo } from './Todo.js';

export type AppSchema = {
  Todo: Todo;
};
```

Include relationship and join entities used by the app. Browser code must use
`import type` for backend definitions.

## Step 4: Read and write

Read query, mutation and paging contracts from the package docs above.
Reuse the app's client. If missing, implement a shared, typed
`RayfinClient<AppSchema>` helper in `src/rayfin/client.ts` using the installed
client declarations. Use `client.data` and `client.auth`.

Continue with [CRUD UI](./rayfin-crud-ui.md) for lists, forms and UI state.

## Notes

Use the shared [app build and deploy workflow](../../../shared/development-standards.md#build--deploy).
