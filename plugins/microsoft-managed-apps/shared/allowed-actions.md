# Allowed Actions (shared connection runtime policies)

Applies to every `/add-*` skill and to `/deploy`.

When a connection reference in `ms.config.json` is **shared**, the app must declare which
connector actions it is allowed to invoke. This is not optional: `ms app pack` and
`ms app deploy` both validate it and **fail the deploy** when it's missing.

---

## Why this exists

A shared connection is exactly that — shared. The same connection can back several apps, and
it carries whatever permissions the person who created it has. Left unrestricted, any app
holding the reference could perform any operation that connection allows: an app that only
needs to read a list could delete from it.

**Runtime policies close that gap.** A shared connection is limited to the operations the app
declares in its config, and that limit is enforced **per app** by the Connectors infrastructure.
Two apps sharing one connection get two independent policies — a read-only dashboard stays
read-only even if the connection itself could write, and neither app's policy affects the other.

That's what `allowedActions` is: the app's declaration of the operations it needs. Anything
not on the list is refused.

```
ms.config.json  ──►  RP at deploy time  ──►  executionRestrictions policy
  allowedActions      (translates it)         on AppConnectionReference
                                                     │
                                                     ▼
                                      host addresses the policy on each request
                                                     │
                                                     ▼
                                       APIHub runs the request through the
                                       policy and allows or refuses it
```

Enforcement lives in the **Connectors infrastructure**, not in the app and not in the managed
apps host. APIHub runs every connector request through the runtime policy and refuses anything
the policy doesn't permit. The host's part is only addressing: it rewrites the outgoing
connector URL to point at the policy rather than the connection, and stamps an
`x-ms-shared-connection-id` header.

So **`allowedActions` is never read at runtime and app code never changes.** Apps keep
addressing connections by id — no SDK upgrade, no rebuild, no import, no client-side
allow-list check.

Do not write runtime code that reads, checks, or reacts to `allowedActions`. There is nothing
to hook. Declaring the list in config *is* the implementation.

---

## When is it required?

Only for **shared** connection references. A reference is shared when its
`sharedConnectionId` is present and non-empty in `ms.config.json`:

```jsonc
"connectionReferences": {
  "shared_office365": {
    "id": "/providers/Microsoft.PowerApps/apis/shared_office365",
    "displayName": "Office 365 Outlook",
    "sharedConnectionId": "abc123...", // ← shared, so allowedActions is required
  },
}
```

**The user never asks for this.** The CLI writes `sharedConnectionId` automatically whenever
the connector's authentication type is shareable, so an ordinary
`ms app add data-source` can produce a shared reference without anyone opting in. Always read
the config back after an add rather than assuming.

Non-shared references (no `sharedConnectionId`, or `null`, or empty) may omit `allowedActions`
entirely. Don't add it to them.

### Detecting shared references

Node 22+ is already a prerequisite for every Microsoft App, so this check runs identically in
bash and PowerShell (unlike `jq`, which isn't on PATH by default on Windows):

```bash
node -e '
const fs = require("fs");
const refs = JSON.parse(fs.readFileSync("ms.config.json", "utf8")).connectionReferences || {};
const ok = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => String(x).trim());
let bad = 0;
for (const [name, r] of Object.entries(refs)) {
  if (!String(r.sharedConnectionId || "").trim()) continue;
  const t = Object.entries(r.dataSets || {}).flatMap(([d, s]) =>
    Object.entries(s.dataSources || {}).map(([k, v]) => [d + "/" + k, v]));
  if (t.length) {
    for (const [p, v] of t) if (!ok(v.allowedActions)) { bad++; console.log("MISSING per-table allowedActions: " + name + " -> " + p); }
  } else if (!ok(r.allowedActions)) { bad++; console.log("MISSING connector-level allowedActions: " + name); }
}
console.log(bad ? bad + " issue(s): fix before deploy" : "OK: all shared references declare allowedActions");
'
```

This mirrors the CLI's own validation, so a clean result here means `ms app pack` /
`ms app deploy` will pass this check. The output also tells you which shape to author:
`per-table` means the reference has dataset tables, `connector-level` means it doesn't.

Non-shared references, and `sharedConnectionId` values that are `null` or whitespace, are
skipped — matching the CLI.

---

## The two authoring shapes

Which shape applies depends on whether the reference has **dataset tables**
(`dataSets[*].dataSources[*]`), not on what kind of connector it nominally is.

### Tabular reference — per-table actions

If the reference has dataset tables, **every table** must declare its own non-empty
`allowedActions`. Connector-level `allowedActions` does not satisfy the requirement for them.

The allowed values are a **fixed vocabulary of four HTTP-shaped verbs**:

| Value      | Covers                                 |
| ---------- | -------------------------------------- |
| `"get"`    | reading / listing rows                 |
| `"post"`   | creating rows                          |
| `"patch"`  | updating rows                          |
| `"delete"` | deleting rows                          |

```jsonc
{
  "connectionReferences": {
    "shared_sql": {
      "id": "/providers/Microsoft.PowerApps/apis/shared_sql",
      "displayName": "SQL Server",
      "sharedConnectionId": "...",
      "dataSets": {
        "default": {
          "dataSources": {
            "Orders": {
              "tableName": "Orders",
              "allowedActions": ["get", "patch"],
            },
            "Customers": {
              "tableName": "Customers",
              "allowedActions": ["get"],
            },
          },
        },
      },
    },
  },
}
```

> Do **not** run `ms connector list-actions` for a table and paste operation IDs like
> `GetItems` or `PatchItem` into a per-table list. Tables take the four verbs above, nothing
> else.

### Action connector — connector-level actions

If the reference has no dataset tables, connector-level `allowedActions` is required. The
values are **Action IDs** exposed by the connector:

```bash
ms connector list-actions --connector <api-id> --json
```

Take the `id` field, and only from entries whose `behavior` is `Allow` — a `Deny` action is
already blocked by org DLP policy, so listing it grants nothing and misleads a later reader.

```jsonc
{
  "connectionReferences": {
    "shared_office365": {
      "id": "/providers/Microsoft.PowerApps/apis/shared_office365",
      "displayName": "Office 365 Outlook",
      "sharedConnectionId": "...",
      "allowedActions": ["SendEmailV2", "GetEmailsV3"],
    },
  },
}
```

### Both — a tabular connector's non-table actions

Connector-level `allowedActions` is still meaningful on a tabular reference: it covers
actions that aren't scoped to a table (for example `ExecuteProcedure` on SQL). Add it
alongside the per-table declarations when the app calls such an action. It does not replace
them.

---

## Choosing the values: least privilege

The point of the policy is to narrow what the shared connection can do on this app's behalf.
Declaring every verb, or every action the connector exposes, passes validation and grants
exactly nothing — don't do it.

Work out what the app actually calls, propose it, and let the user confirm.

**1. Find the generated service for the data source.** Codegen lands in `generated/` at the
project root, e.g. `generated/services/Office365OutlookService.ts`.

**2. Grep `src/` for calls into it.** Per
[connector-reference.md](./connector-reference.md), never read the whole generated file:

```bash
# Which service methods does the app actually call?
grep -rhoE '\b<ServiceName>\.[A-Za-z0-9_]+' src/ | sort -u
```

**3. Map the calls to values.**

For a **table**, map by what the method does:

| Method shape                                      | Verb       |
| ------------------------------------------------- | ---------- |
| `Get*`, `List*`, anything that reads or queries   | `"get"`    |
| `Create*`, `Post*`, `Insert*`                     | `"post"`   |
| `Update*`, `Patch*`                               | `"patch"`  |
| `Delete*`, `Remove*`                              | `"delete"` |

For an **action connector**, the generated method name corresponds to the connector's Action
ID. Confirm the exact casing against `ms connector list-actions --connector <api-id> --json`
rather than guessing from the TypeScript name — use the `id` from that output verbatim.

**4. Propose and confirm.** Show the user what you inferred and what it will permit, per
reference and per table:

> "`shared_sql` is a shared connection, so it needs an action policy before deploy. From the
> code, the app reads and updates `Orders`, and only reads `Customers`. I'd declare:
> `Orders: ["get", "patch"]`, `Customers: ["get"]`. Anything else it should be allowed to do?"

Wait for confirmation. If the app doesn't call the data source at all yet, say so and ask what
to grant rather than inventing a set — an unused binding still has to declare something
non-empty to pass validation.

**5. Write it into `ms.config.json`** and record the decision in `memory-bank.md` so the next
session doesn't re-litigate it.

### Deferring when there's no app code yet

Inference needs code to inspect. When a shared reference is created before the app is written
— the normal case during `/create-app`, which adds data sources before generating the UI —
don't guess a set and don't prompt for one.

Leave `allowedActions` unset, record the reference as **shared, policy pending** in
`memory-bank.md`, and decide once the app code exists. This is safe because:

- `ms app dev` does **not** validate — only `ms app pack` and `ms app deploy` do
  (`assertAppConfigSchemaValid` is called from the pack/deploy path, not the dev path). Local
  iteration is completely unaffected.
- `/deploy` runs the same check as a preflight gate, so a pending policy surfaces before it can
  reach a failing deploy.

A deferred policy is a tracked to-do, not a silent gap. An *undeferred* guess is worse than
both: it either over-grants or breaks the app at runtime.

---

## Validation rules

The CLI enforces these before build/upload, on both `ms app pack` and `ms app deploy`:

| Condition                                                    | Rule                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Shared reference **with** dataset tables                     | **every** table must declare non-empty `allowedActions`        |
| Shared reference **without** dataset tables                  | connector-level `allowedActions` required, non-empty           |
| Any `allowedActions` that is present                         | must have ≥1 entry, and no entry may be blank/whitespace       |
| Non-shared reference                                         | may omit `allowedActions` entirely                             |

Failure surfaces as:

```
Invalid ms.config.json for shared connection policy enforcement:
<issues>
```

with one or more of:

| Issue                                                                                        | Fix                                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `allowedActions must contain at least one non-empty action identifier.`                        | The array is empty or has a blank entry. Populate it, or remove it if the reference isn't shared. |
| `Shared connection references with dataset tables must declare allowedActions for every table.` | At least one table under `dataSets[*].dataSources[*]` is missing it. The message's path names the dataset and data source. |
| `Shared connection references without dataset tables must declare connector-level allowedActions.` | Add connector-level `allowedActions` with Action IDs from `ms connector list-actions`. |

Never work around a failure by deleting `sharedConnectionId` — that field reflects how the
connection was actually created, and removing it misrepresents the binding.

---

## Gotchas

- **Adding a table later invalidates the config.** A new table on an already-shared tabular
  reference must declare its own `allowedActions`. The next deploy fails until it does, so
  handle it as part of the add rather than at deploy time.
- **Stage overlays cannot carry `allowedActions`.** A deployment overlay
  (`ms.<deployment>.config.json`) whitelists only `sharedConnectionId`, `dataSets`,
  `xrmConnectionReferenceLogicalName`, and `dataSourcesShareLinks`, and every object is
  closed — an `allowedActions` key there is a schema error, not a silent override. Author it
  in the base `ms.config.json`. If an overlay makes a reference shared for one stage, the base
  config still has to satisfy the policy.
- **There is no CLI command for this yet.** `allowedActions` is hand-edited into
  `ms.config.json` today. A flag or command is a possible fast-follow; if a future CLI version
  exposes one, prefer it over hand-editing.
- **Editor squiggles.** `ms.config.json` is validated against the published
  [`ms.config.schema.json`](https://raw.githubusercontent.com/microsoft/Managed-Apps/main/schemas/ms.config.schema.json).
  If the project pins an older `$schema` copy that predates this field, the editor may flag it
  even though the CLI accepts it — point the user at the current URL rather than dropping the
  field.
