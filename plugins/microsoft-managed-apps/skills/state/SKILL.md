---
name: state
description: Store and query a Microsoft Managed App's built-in state with `ms project state` CLI schema commands and generated TypeScript clients. First run `ms feature status --name state`; if it is not enabled, recommend an alternative connector or data source.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Managed Apps State with CLI schema + generated client

Every Microsoft Managed App can use built-in app state when the `state` feature is enabled for the
current CLI/environment. Records are grouped into collections by an item type name; the server
assigns each record an `itemId`.

For schema-backed state, **do not edit schema JSON by hand.** Use `ms project state ...` to change
the schema, run `ms project state generate-code`, then call the generated TypeScript services from
app code.

## Mandatory feature gate

Before using any guidance in this skill, run:

```bash
ms feature status --name state
```

Continue only when the command reports that `state` is enabled. If the command fails, the feature is
not found, or the output reports disabled/off/unavailable, stop and do **not** run any
`ms project state ...` command.

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
bun add -D @microsoft/managed-apps-vite-plugin@latest
```

Then update the app's `vite.config.ts` so the `managedApps()` plugin call enables the local gateway:

```ts
managedApps({ devMode: 'localGateway' })
```

If the app already passes options, preserve them and add `devMode`:

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

Do not "fix" local data failures with a middle-tier function, proxy, custom auth header, connector,
or direct endpoint wrapper. Fix the Vite plugin/local gateway setup instead.

## Contract

| Surface | Use | Don't use |
| --- | --- | --- |
| Feature gate | `ms feature status --name state` before any state work | assuming the feature is available |
| Schema edits | `ms project state add`, `alter`, `remove`, `set-setting` | manual edits to `state/schema.json`, `ms.schema.json`, or another configured schema file |
| Code generation | `ms project state generate-code` | handwritten model/service/validator files in the generated output folder |
| App data access | generated services, models, validators, and typed query helpers | treating direct state requests as the default when codegen covers the scenario |
| Testing data behavior | latest Vite plugin + `managedApps({ devMode: 'localGateway' })` + `ms app dev`; Preview for pre-deploy validation | local dev without local gateway mode |

The generated services own request shapes, ETags, typed filters, paging, validation hooks, per-user
scope behavior, and service route details. App code should compose those services with UI/business
logic instead of duplicating transport behavior.

## Workflow

1. Run `ms feature status --name state`. Stop and recommend a connector alternative unless it is
   enabled.
2. Find the app root (`ms.config.json`) and the configured schema path.
3. Inspect existing state schema/settings with `ms project state list-schema` and
   `ms project state list-settings`.
4. Make schema changes only with `ms project state ...` commands.
5. Run `ms project state generate-code` after every successful schema change.
6. Import and use the generated TypeScript services from app code.
7. Configure local gateway mode before local data testing.
8. Build/typecheck and verify that generated services are used for behavior covered by codegen.

## Schema setup

Find the app root (`ms.config.json`) and the configured schema path. Prefer `state.schemaPath`; older
apps may use `data.schemaPath` or legacy `db.schemaPath`.

```json
{
  "state": {
    "schemaPath": "state/schema.json"
  }
}
```

If no schema path exists yet, start by adding the first collection with the CLI. The CLI initializes
the local schema path/file as needed; don't ask the user to hand-configure schema wiring first.
After that, schema content is managed with CLI commands only.

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

The first collection add can initialize a missing schema file. Do not create the schema JSON by hand.

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
- **Indexes:** at most four custom indexed properties per collection. Platform properties are
  indexed separately.
- **Name property:** prefer a human-readable `name` property for each item. It is writable, indexed,
  sortable/filterable, and generated services treat it as the display/title field when present.

### Alter a property

```bash
ms project state alter --collection task --property name --max-length 300
ms project state alter --collection task --property done --required false
ms project state alter --collection task --property name --max-length ""
```

Only pass the flags you intend to change. Empty string clears a type-specific constraint where the
CLI supports clearing.

Be careful with indexes on deployed fields: changing or removing an existing index is rejected, and
adding an index to an already-deployed property must be validated in Preview.

### Remove a property

```bash
ms project state remove --collection task --property obsoleteField
```

Use `--force` only when non-interactive automation is necessary and the user already approved the
removal:

```bash
ms project state remove --collection task --property obsoleteField --force
```

Collection removal is intentionally rejected. Do not work around it by editing the schema file.

### Change schema settings

Set exactly one setting per command:

```bash
ms project state set-setting --locale en-US
ms project state set-setting --validation true
ms project state set-setting --validation false
```

`--validation false` keeps declared indexes active but makes writes index-only/unvalidated.

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

  return taskService.create(input);
}
```

Direct state requests are acceptable when there is a deliberate reason to bypass generated helpers,
but they should not be the default for schema-backed collections:

```ts
await fetch('/.ms/db/task/items', {
  method: 'POST',
  body: JSON.stringify(input),
});

await fetch('/.ms/state/task/items', {
  method: 'POST',
  body: JSON.stringify(input),
});
```

## Generated-service behavior

- **Create/update validation:** generated validators enforce the declared schema when validation is
  enabled. `update` is a full-document PUT/upsert, not a partial patch.
- **Edit with concurrency:** generated edit helpers read the item, shallow-merge callback changes,
  validate, and send the exact quoted ETag in `If-Match`. Only `412` is retried.
- **Server-owned fields:** `itemId`, `createdTime`, `modifiedTime`, and `@odata.etag` are read-only.
  Do not send them in write models.
- **Queries:** use generated typed filters for indexed fields. Paging follows `@odata.nextLink`.
- **Per-user data:** for `x-ms-ownership: "perUser"`, generated services expose scope-aware reads
  and writes. Do not send scope to non-per-user collections.

## Rules / gotchas

- **Feature gate first.** Never use this skill's state workflow before `ms feature status --name state`
  reports enabled.
- **Schema changes are CLI-only.** Never patch the schema JSON to add properties, constraints,
  indexes, locale, or validation settings.
- **Unsupported schema shapes need a decision.** If the requested design needs nested objects,
  arrays, enums, `$ref`, composition keywords, `pattern`, or defaults and the CLI cannot represent
  it, stop and ask. Do not silently switch to manual schema editing.
- **Indexes freeze after deployment for existing columns.** Preview schema/index changes before live
  deploy.
- **Never drop a declared collection/item type** by hand. Collection removal is not a supported CLI
  write.
- **Do not run `ms project state clear`** unless the user explicitly asks to discard all Preview
  state for the app/environment. It is not part of schema editing or code generation.
- **CLI attribution is automatic.** Do not tell users to export `MS_CLI_ORIGIN`; the host hook adds
  it for `ms` invocations unless the user already set a value.

## Verification

```bash
ms feature status --name state
ms project state list-schema
ms project state list-settings
ms project state generate-code --json
```

Then:

- confirm the app uses the latest `@microsoft/managed-apps-vite-plugin`;
- confirm `vite.config.ts` calls `managedApps({ devMode: 'localGateway' })` or preserves existing
  options while adding `devMode: 'localGateway'`;
- run the narrowest relevant build/typecheck/lint for the app or package;
- prefer generated services for schema-backed state behavior covered by codegen;
- run local gateway dev with `ms app dev` and verify generated-service behavior locally;
- optionally preview the committed build with `ms app play --mode preview --commit <sha>` before
  deploying.
