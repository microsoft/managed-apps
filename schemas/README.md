# Schemas

Public JSON Schemas for Microsoft App configuration files. Editors (VS Code and anything
else that honors `$schema`) fetch these by URL, so an app project gets completion and
validation without a generated copy checked into the project.

| File                        | Describes                                                             | Referenced by                                   |
| --------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| `ms.config.schema.json`     | The base app config, `ms.config.json`                                 | `ms app create` / `ms app init`                 |
| `stage-overlay.schema.json` | A deployment config overlay, `ms.<deployment>.config.json`            | `ms app add config --deployment <name>`         |

Stable URLs:

```
https://raw.githubusercontent.com/microsoft/Managed-Apps/main/schemas/ms.config.schema.json
https://raw.githubusercontent.com/microsoft/Managed-Apps/main/schemas/stage-overlay.schema.json
```

## Do not hand-edit

Both files are generated from the Zod contracts that the CLI and runtime validate against
(`@microsoft/managed-apps-common`, `src/config/V0/Schema.ts` and
`src/config/stage/OverlaySchema.ts`). Editing them here would let the published schema drift
from what the CLI actually enforces. Regenerate from the product repo and open a PR with the
result instead.

An overlay is a binding-only delta: it may carry only the whitelisted fields, and every object
is closed (`additionalProperties: false`), so a non-whitelisted key is a schema error rather
than a silently ignored one.
