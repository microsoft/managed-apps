---
name: state
description: Store and query a Microsoft Managed App's built-in state and file attachments with `ms project state` CLI schema commands and generated TypeScript clients. First, with the user signed in to the CLI, run `ms feature status --name state --json`; if `feature.enabled` is not `true`, recommend an alternative connector or data source.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Managed Apps State with CLI schema + generated client

Every Microsoft Managed App can use built-in app state when the `state` feature is enabled for the
current CLI/environment: a NoSQL store the app calls directly (no middle-tier function, connector,
or SDK; the host attaches auth). Records are grouped into collections by an item type name; the
server assigns each record an `itemId`.

For schema-backed state, **do not edit schema JSON by hand.** Use `ms project state ...` to change
the schema, run `ms project state generate-code`, then call the generated TypeScript services from
app code.

## Mandatory feature gate

Before using any guidance in this skill, it is recommended that the user is signed in to the CLI. Run
`ms auth status`, and if it reports no signed-in account, ask the user to run `ms auth login`.
`ms feature status` never prompts for sign-in, and features that are on by default for the user's
organization only apply once they are signed in, so a signed-out check can report `state` as
disabled even when it is available to them.

Then run:

```bash
ms feature status --name state --json
```

Continue only when the output has `"success": true` and `feature.enabled` is `true`. Read the JSON
rather than the human-readable output, which lists several settings that can each say "enabled". If
the command fails (non-zero exit or `"success": false`), the feature is not found, or
`feature.enabled` is `false`, stop and do **not** run any `ms project state ...` command.

When state is not enabled, recommend an alternative data-source path based on the user's need:

- Durable relational/business data: use `/add-dataverse`.
- SharePoint lists or document-backed collaboration data: use `/add-sharepoint`.
- Workbook-backed tabular data: use `/add-excel`.
- Mail, calendar, user profile, Teams, Azure DevOps, OneDrive, Copilot Studio, or Work IQ scenarios:
  use the matching `/add-*` skill.
- Anything else: use `/add-data-source` to discover and bind the appropriate connector.

Do not suggest manual schema edits or custom proxy workarounds as a substitute for the disabled
feature.

## ⚠️ Local testing requires local gateway mode

Generated state services require the Managed Apps local gateway path during local development.
Before testing data behavior locally, install the latest `@microsoft/managed-apps-vite-plugin` and
opt the app into local gateway mode.

Install the latest Vite plugin with the app's package manager:

```bash
npm install -D @microsoft/managed-apps-vite-plugin@latest
# or: bun add -D @microsoft/managed-apps-vite-plugin@latest
# or: pnpm add -D @microsoft/managed-apps-vite-plugin@latest
# or: yarn add -D @microsoft/managed-apps-vite-plugin@latest
```

Then update the app's `vite.config.ts` so the `managedApps()` plugin call enables the local gateway,
preserving any existing options:

```ts
managedApps({
  ...existingOptions,
  devMode: 'localGateway',
})
```

Now run local dev normally:

```bash
ms app dev
```

Do not change the app architecture just to work around local data failures (no middle-tier
functions, proxies, or CORS/auth workarounds). Fix the Vite plugin/local gateway setup instead.

## Contract

| Surface | Use | Don't use |
| --- | --- | --- |
| Feature gate | `ms feature status --name state --json` (`feature.enabled`), with the user signed in, before any state work | assuming the feature is available |
| Schema edits | `ms project state add`, `alter`, `remove`, `set-setting` | manual edits to `state/schema.json`, `ms.schema.json`, or another configured schema file |
| Code generation | `ms project state generate-code` | handwritten model/service/validator files in the generated output folder |
| App data access | generated services, models, validators, and typed query helpers | treating direct state requests as the default when codegen covers the scenario |
| File attachments | direct upload to `/.ms/state/attachments`, then save the returned URL through a generated service | storing file bytes inside items |
| Testing data behavior | latest Vite plugin + `managedApps({ devMode: 'localGateway' })` + `ms app dev`; Preview for pre-deploy validation | local dev without local gateway mode |

The generated services own request shapes, ETags, typed filters, paging, validation hooks, per-user
scope behavior, and service route details. App code should compose those services with UI/business
logic instead of duplicating transport behavior.

## Workflow

1. Make sure the user is signed in (`ms auth status`; ask them to run `ms auth login` if not), then
   run `ms feature status --name state --json`. Stop and recommend a connector alternative unless
   `feature.enabled` is `true`.
2. Find the app root (`ms.config.json`) and the configured schema path.
3. Inspect existing state schema/settings with `ms project state list-schema` and
   `ms project state list-settings`.
4. For each new collection, decide up front whether records are per-user (see below).
5. Make schema changes only with `ms project state ...` commands.
6. Run `ms project state generate-code` after every successful schema change.
7. Import and use the generated TypeScript services from app code.
8. Configure local gateway mode before local data testing.
9. Build/typecheck and verify that generated services are used for behavior covered by codegen.

## Schema setup

Find the app root (`ms.config.json`) and the configured schema path. Prefer `state.schemaPath`; older
apps may use `data.schemaPath` or legacy `db.schemaPath`.

```json
{
  "state": {
    "schemaPath": "state/schema.json",
    "enabled": true
  }
}
```

If no schema path exists yet, start by adding the first collection with the CLI. It writes
`state.schemaPath: "state/schema.json"`, creates the schema file, and sets `enabled: true` unless the
config already sets `enabled`; don't ask the user to hand-configure schema wiring first. The app
serves no state while `enabled` is `false`, so confirm with the user before changing an explicit
`false`. New schemas take the machine's locale (or `en-US`); match the app's users with
`ms project state set-setting --locale <tag>`.

Inspect the current schema:

```bash
ms project state list-schema
ms project state list-settings
```

## CLI schema commands

### Add a collection

```bash
ms project state add --collection task
```

### Add properties

```bash
ms project state add --collection task --property name --type string --required true --max-length 200 --index true --index-ignore-case true
ms project state add --collection task --property done --type boolean
ms project state add --collection task --property dueDate --type datetime --index true
ms project state add --collection task --property attachment --type binary --kind binary
```

- **Types:** `string`, `number`, `integer`, `boolean`, `datetime`, `guid`, `binary`.
- **Boolean flags take values:** `--required true`, `--index false`, etc. They are not bare
  switches.
- **Indexes:** at most four custom indexed properties per collection, top-level scalars only. Only
  indexed properties (plus `itemId`, `name`, `createdTime`, `modifiedTime`) can be filtered or sorted.
- **Name property:** prefer a human-readable `name` property for each item (put a single-string
  item's text there). It is writable, indexed, sortable/filterable, and generated services treat it
  as the display/title field.

### Alter a property

```bash
ms project state alter --collection task --property name --max-length 300
ms project state alter --collection task --property done --required false
ms project state alter --collection task --property name --max-length ""
```

Only pass the flags you intend to change. Empty string clears a type-specific constraint where the
CLI supports clearing.

Indexes are add-only. Removing an index or changing its options (including the platform index on
`name`) is rejected even before the first deploy, so choose `--index-ignore-case` and
`--index-ignore-accents` when you add the property. Adding an index to an already-deployed property
is allowed, but validate it in Preview first.

### Remove a property

```bash
ms project state remove --collection task --property obsoleteField
```

Use `--force` only when non-interactive automation is necessary and the user already approved the
removal. Stored values are not deleted. Collection removal is intentionally rejected; do not work
around it by editing the schema file.

### Change schema settings

Set exactly one setting per command:

```bash
ms project state set-setting --locale en-US
ms project state set-setting --validation true
ms project state set-setting --validation false
```

`--validation false` keeps declared indexes active but makes writes index-only/unvalidated.

### Per-user collections

Make a collection per-user when a record belongs to one person (drafts, preferences, personal
notes); skip it for catalogs, reference data, and anything collaborative. **Decide before it holds
records:** ownership is immutable and can't be added to a collection that has data. The CLI has no
ownership flag, so this is the one schema edit allowed by hand, and only after the user agrees: add
`"x-ms-ownership": "perUser"` to the collection's root object (not a property), change nothing
else, and regenerate.

Generated services then take a `scope` option: `private` writes/reads only the caller's records,
`shared` writes/reads records visible to all users, and omitting it writes private and reads both.
Pass it explicitly on writes. The owner always comes from the caller's token; reads include a
platform-managed `@ms.scope` that you must not send back.

## Generate the typed client

Run this after every successful schema change:

```bash
ms project state generate-code
```

For automation or precise diagnostics:

```bash
ms project state generate-code --json
```

Output is written to `generated-typescript/` beside the configured schema file. For
`state.schemaPath: "state/schema.json"`, output is `state/generated-typescript/`.

Treat that folder as generator-owned:

- first generation accepts a missing or empty directory;
- replacement requires the ownership manifest and no untracked handwritten files;
- move handwritten wrappers/hooks outside the generated directory;
- never edit generated models, services, validators, query helpers, or manifests by hand.

## App code

Import from the generated barrel and use generated types/services/validators.

```ts
import {
  createTaskService,
  type TaskCreate,
  type TaskRead,
  validateTaskCreate,
} from '../state/generated-typescript';

const taskService = createTaskService();

export async function createTask(input: TaskCreate): Promise<TaskRead> {
  const validation = validateTaskCreate(input);

  if (!validation.success) {
    throw new Error('Task input is invalid.');
  }

  const result = await taskService.create(input);
  if (!result.success) {
    throw new Error(`Could not create the task: ${result.error.message}`);
  }
  return result.data;
}
```

Direct requests to `/.ms/state/{collection}/items[/{itemId}]` are acceptable only with a deliberate
reason to bypass the generated services. They follow the same contract: send `@odata.etag`
verbatim as `If-Match`, follow `@odata.nextLink` to page (`$skip` is rejected), and quote string
and date literals in `$filter`.

## Generated-service behavior

- **Results, not exceptions:** service calls return `{ success: true, data }` or
  `{ success: false, error }` (`error.kind`, `message`, `status`, `validationErrors`). Check
  `success` before using `data`.
- **Create/update validation:** generated validators enforce the declared schema when validation is
  enabled. `update` is a full-document PUT/upsert, not a partial patch.
- **Edit with concurrency:** generated edit helpers read the item, shallow-merge callback changes,
  validate, and send the exact quoted ETag in `If-Match`. Only `412` is retried.
- **Delete is idempotent:** deleting a missing item succeeds, so retries are safe.
- **Server-owned fields:** `itemId`, `createdTime`, `modifiedTime`, and `@odata.etag` are read-only.
  Do not send them in write models.
- **Queries:** use generated typed filters for indexed fields. Paging follows `@odata.nextLink`.
- **Per-user data:** for `x-ms-ownership: "perUser"`, generated services expose scope-aware reads
  and writes. Do not send scope to non-per-user collections; the service rejects it with `400`.

## File attachments

Generated services don't upload files. Declare a reference property
(`ms project state add --collection note --property photo --type binary --kind image`), regenerate,
then upload the bytes and save the returned URL through the generated service:

```ts
const uploaded = await fetch('/.ms/state/attachments', {
  method: 'POST',
  headers: { 'Content-Type': file.type || 'application/octet-stream' }, // required
  body: file,
}).then((response) => response.json()); // { id, url, contentType, size }

const saved = await noteService.update(note.itemId, { ...noteFields, photo: uploaded.url });
```

Display it with `<img src={note.photo} />`.

- Save within **15 minutes**, or the unreferenced upload is garbage-collected. Store `url` verbatim.
- Attachments have no DELETE or PUT: save the property as `null` (or delete the item) to remove one,
  and upload a new file to replace it. A file belongs to one item (`409` otherwise).
- No filename is stored; add a separate property if needed. Limits: 10 MiB per file, 10,000 files
  and 1 GiB per app. Use a real image `Content-Type` for `<img>`; SVG is always downloaded.

## Preview has its own state

`ms app play --mode preview --commit <sha>` (full SHA, after `ms app build --commit <sha>`) runs the
app against a **separate Preview store**: same collections, different records. Test writes,
validation, and schema/index changes there before `ms app deploy`. Preview only engages when the
previewed commit differs from the deployed one. After deploying, click **Refresh** on the app's
*New version available* banner before testing schema changes; a plain reload keeps the old schema.

To purge Preview records (with the user's explicit approval, see rules), run
`ms project state clear --force --json --non-interactive` in the app folder. `isComplete: false` is
normal because deletion finishes in the background; don't retry, and wait a minute or two before
relaunching Preview or deploying.

## Rules / gotchas

- **Feature gate first.** Never use this skill's state workflow before
  `ms feature status --name state --json` reports `feature.enabled: true`.
- **Schema changes are CLI-only.** Never patch the schema JSON to add properties, constraints,
  indexes, locale, or validation settings. The only exception is per-user ownership, as described
  above.
- **Unsupported schema shapes need a decision.** If the requested design needs nested objects,
  arrays, enums, `$ref`, composition keywords, `pattern`, or defaults and the CLI cannot represent
  it, stop and ask. Do not silently switch to manual schema editing.
- **Indexes are add-only.** The CLI rejects removing an index or changing its options, deployed or
  not. Decide index options when adding a property, and Preview any index added to a deployed
  property before live deploy.
- **Never drop a declared collection/item type** by hand. Collection removal is not a supported CLI
  write.
- **Do not run `ms project state clear`** unless the user explicitly asks to discard all Preview
  state for the app/environment. It is not part of schema editing or code generation.
- **CLI attribution is automatic.** Do not tell users to export `MS_CLI_ORIGIN`; the host hook adds
  it for `ms` invocations unless the user already set a value.

## Verification

```bash
ms feature status --name state --json
ms project state list-schema
ms project state list-settings
ms project state generate-code --json
```

Then:

- confirm `ms.config.json` has `enabled: true` on its state (or `data`/`db`) section;
- confirm the app uses the latest `@microsoft/managed-apps-vite-plugin`;
- confirm `vite.config.ts` calls `managedApps({ devMode: 'localGateway' })` or preserves existing
  options while adding `devMode: 'localGateway'`;
- run the narrowest relevant build/typecheck/lint for the app or package;
- prefer generated services for schema-backed state behavior covered by codegen;
- run local gateway dev with `ms app dev` and verify generated-service behavior locally;
- preview the committed build with `ms app play --mode preview --commit <sha>` before deploying.
