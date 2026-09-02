# Connector Reference

Applies to all `/add-*` skills.

## Connections — created inline by the CLI

There is **no separate "create connection" command**. Connections are created and resolved
inline by `ms app add data-source` (the single add command — there is no `ms app add action` /
`ms app add table` / `ms app add procedure`):

```bash
ms app add data-source --connector <api-id> [--as table|action] [--connection-id <id> | -c <id>]
```

> **Deprecated alias:** `ms app add connector` is the former name of this command. It still works
> but is **deprecated** — prefer `ms app add data-source` (same handler and flags).

When you run it, the CLI resolves a connection for `<api-id>` as follows:

**Interactive (default, a TTY is attached):**

1. Lists the existing connections for that connector in the active environment and adds a
   `(Create a new connection)` option.
2. If you pick an existing connection, it's used.
3. If you pick `(Create a new connection)`:
   - **SSO-only connectors** (a single SSO-eligible auth type) are created **silently**, with
     no browser. If silent creation fails, the CLI falls back to the browser flow below.
   - **All other connectors** open a **browser** OAuth/consent dialog (served by a local
     callback). On success the new connection's ID is printed and used.

**Non-interactive (`--non-interactive`):** the CLI does **not** open a browser and does **not**
create a connection. If `--connection-id` / `-c` is omitted, it **first prints a table of the
available connections** for that connector (Display Name + Connection ID, or
"No connections found in this environment.") and **then** errors, instructing you to re-run
with `--connection-id <id>`. Copy a Connection ID from that printed table and pass it
explicitly. If no connection exists yet, **run the command once interactively** (omit
`--non-interactive`) so the CLI creates it, then reuse the printed Connection ID.

So interactively you do NOT need to pre-create connections or pass `--connection-id`; you only
need it to bypass the picker or to script a non-interactive run.

### Shared connections require an action policy

When the connection's authentication type is shareable, the CLI **automatically** records a
`sharedConnectionId` on the connection reference it writes to `ms.config.json`. Nobody opts
into this — an ordinary `ms app add data-source` can produce a shared reference.

A shared reference must declare `allowedActions`, or `ms app pack` / `ms app deploy` fails
validation. So after every add, read `ms.config.json` back and check the reference you just
created:

- `sharedConnectionId` empty / absent → nothing to do.
- `sharedConnectionId` set → declare the actions before moving on.

Per-table `allowedActions` (`"get"` / `"post"` / `"patch"` / `"delete"`) for tabular
references, connector-level Action IDs for action connectors. Full rules, the least-privilege
inference procedure, and failure recovery live in
[allowed-actions.md](./allowed-actions.md).

### Dataverse is different

The tabular Dataverse connector (`--connector dataverse`) doesn't use the connection-id model —
`ms app add data-source --connector dataverse --as table --table <name>` resolves the active
environment's Dataverse automatically. No `--connection-id` is required (or accepted). (The
separate `shared_commondataserviceforapps` connector instead pairs `--table` with
`--dataverse-environment-id`.)

## Inspecting Large Generated Files

Generated service files (e.g., `Office365OutlookService.ts`) can be thousands of lines. **Do NOT read the entire file.** Instead:

1. **List available methods** with Grep:
   ```
   Grep pattern="async \w+" path="generated/services/<Connector>Service.ts"
   ```

2. **Find a specific method** and read just that section:
   ```
   Grep pattern="async GetEventsCalendarViewV2" path="generated/services/Office365OutlookService.ts" -A 20
   ```

3. **Find parameter types** in the models file:
   ```
   Grep pattern="interface CalendarEventHtmlClient" path="generated/models/Office365OutlookModel.ts" -A 30
   ```

This avoids context-window bloat. Generated services and models land in `generated/` at the project root (e.g., `generated/services/Office365OutlookService.ts`, `generated/models/Office365OutlookModel.ts`). Import them from your `src/` files using relative paths like `../../generated/services/<ServiceName>`.

## Sub-Skill Invocation

When a connector skill is invoked from another skill (e.g., `/create-app` plans `/add-office365`):

- **Check `$ARGUMENTS`** — if provided, use it as the connector name or configuration.
- **Skip redundant questions** — don't re-ask things the caller already provided (project path, connection id, etc.).
- **Memory bank is still read** — but skip the summary if the caller just updated it.

## Build After, Don't Deploy

Every `/add-*` skill runs `npm run build` after the `ms app add ...` call to catch type errors in the generated services. **None of them push or deploy.** Deployment happens only via `/deploy`, which always requires explicit user confirmation.

The one thing every `/add-*` skill must do *before* that build is the shared-connection check
above — a missing `allowedActions` doesn't surface as a build error, it surfaces much later as
a deploy failure.
