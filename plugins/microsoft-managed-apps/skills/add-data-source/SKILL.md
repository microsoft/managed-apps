---
name: add-data-source
description: Canonical add flow for Microsoft Managed Apps. Use when adding any data source through `ms app add data-source` (with `--as table` or `--as action`), or when the user wants help discovering which connector / api-id to use.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

**Reference:** [connector-reference.md](${CLAUDE_PLUGIN_ROOT}/shared/connector-reference.md) — Inline connection creation, Grep-first for large generated files.

**Reference:** [allowed-actions.md](${CLAUDE_PLUGIN_ROOT}/shared/allowed-actions.md) — Shared connections must declare `allowedActions` before deploy (Step 4).

# Add Data Source (Canonical)

This is the **single implementation** for all connector-binding skills.

**Delegation model:**
- Specialized `/add-*` skills (e.g., `/add-office365`, `/add-workiq`) delegate to this skill with presets
- If this skill is called from a wrapper, **do not delegate back** 
- If this skill is called directly, complete the workflow without delegation

**After the connector is added:**
- If invoked via a specialized skill → Refer to that specialized skill's documentation for usage patterns (it was already provided)
- If invoked directly → Identify which specialized skill matches your use case and refer to its documentation for:
  - Correct import paths for generated services
  - Best practices for using the connector
  - Common patterns and implementation examples
  - Error handling guidance

This ensures developers have complete context for implementing features, not just adding the connector.

## Workflow

1. Verify workspace + auth.
2. Resolve `api-id` (discover via `ms connector list` if the user didn't supply one), `mode`, and required arguments.
3. Run the matching `ms app add ...` command.
4. Check for a shared connection and declare `allowedActions` if so.
5. Run `npm run build`.
6. Record the binding in `memory-bank.md` if present.

---

### Step 1: Verify Project + Env

```bash
test -f ms.config.json || { echo "Not in a Microsoft App workspace."; exit 1; }
BIN=ms
$BIN auth status
```

### Step 2: Resolve Inputs

Collect:

- `api-id` (required — see resolution order below). Passed to the CLI via `--connector <api-id>`.
- `mode` = `action` | `table` (controls the `--as` flag). There is **no** `procedure` mode —
  binding a specific SQL stored procedure is not exposed by the current CLI (see note below).
- `connection-id` (optional interactive, required for non-interactive where applicable)

Additional by mode:

- `table`: `dataset`, `table`

> **SQL stored procedures:** the CLI has no `ms app add procedure` command and `ms app add data-source`
> does not accept `--sql-stored-procedure`. You can still add the SQL data source as a table
> (`--connector shared_sql --as table --dataset <db> --table <tbl>`), but binding a specific
> stored procedure is not currently supported.

#### 2a. Resolve `api-id`

Try sources in this order; stop at the first one that yields a value:

1. **Wrapper preset.** If invoked by a specialized `/add-*` skill (see "Common Presets" below), use the preset api-id and skip discovery.
2. **Caller-supplied.** If `$ARGUMENTS` includes an `api-id` (e.g., `api-id=shared_office365`), use it verbatim.
3. **User-supplied verbatim string.** If the user already typed an api-id (anything matching the `shared_*` / `dataverse` / `microsoftcopilotstudio` shape, or a string they explicitly call an api-id), use it.
4. **Discovery via `ms connector list`.** **Do not ask the user to type an api-id from memory.** Instead:

   a. Ask one question: "Which connector do you need? (a short keyword like 'teams', 'sql', 'sharepoint', 'salesforce' is fine — I'll search the catalog.)" Capture the keyword as `{term}`.

   b. Search the catalog:
      ```bash
      $BIN connector list --search "<term>"
      ```
      Parse the output into a short table (display name + api-id). If the result set is large (more than ~10 rows), narrow with a more specific term and re-run rather than dumping everything.

   c. Present the candidates to the user via `AskUserQuestion` with the display names as choices (and api-ids in parentheses for transparency). Map their selection back to the api-id; never ask them to retype it.

   d. If `ms connector list --search "<term>"` returns no results, fall back to `ms connector list` with no filter, surface a representative slice, and ask the user to refine the term. Do not proceed with a guessed api-id.

5. **Validation.** Once an api-id is chosen, confirm it's real before spending a build cycle on it: `$BIN connector list-actions --connector <api-id> --search ""` should succeed. If the CLI replies that the api-id is unknown, drop back to step 4 — don't keep retrying with the same value.

#### Work IQ intent hint

When user intent is about **knowledge retrieval / grounded Microsoft 365 search summaries** (for example: "analyze M365 content", "search my email and Teams", "knowledge-grounded query"), default to:

- `api-id`: `shared_a365copilotchatmcp`
- `mode`: `action`

⚠️ **IMPORTANT:** If the user is adding Work IQ via `/add-data-source`, **ask them to use `/add-workiq` instead.**

**Why:** Work IQ uses MCP (Model Context Protocol), a stateful protocol that requires special handling. The `/add-workiq` skill provides:
- Complete `McpSession` wrapper class (handles session initialization, auto-retry, response parsing)
- Best practices for structuring prompts
- Error handling patterns
- Multi-turn conversation support

**Guidance:** "I can add the connector, but for Work IQ I recommend using `/add-workiq` — it provides a production-ready `McpSession` class and comprehensive patterns to avoid common errors. Would you like to use `/add-workiq` instead?"

If they insist on `/add-data-source`, proceed but **after adding the connector, refer them to the `/add-workiq` skill documentation** so they understand the McpSession requirement.

#### 2b. Resolve `mode`

For api-ids in the "Common Presets" table, use that table's mode. Otherwise ask the user one question, framed by what they want to do:

- "Read or write rows in a tabular store?" → `table`
- "Trigger an operation (send a message, post a file, list events)?" → `action`

`mode` selects the `--as` flag. Tabular connectors (e.g. SharePoint, SQL) support both; in
non-interactive runs `--as` is **required** for them. Action-only connectors ignore `--as`.

If the caller is a wrapper skill, use wrapper presets as defaults and only ask for missing fields.

### Step 3: Execute Add Command

All modes use the single `ms app add data-source` command; `--as` chooses table vs action. The
connector is passed via `--connector` (there is **no** `--api-id` flag).

> **Deprecated alias:** `ms app add connector` still works but is **deprecated** — prefer
> `ms app add data-source`. Both share the same handler and flags.

**Action mode**

```bash
$BIN app add data-source --connector <api-id> --as action
```

**Table mode**

```bash
$BIN app add data-source --connector <api-id> --as table --dataset "<dataset>" --table "<table>"
```

The CLI resolves a connection inline (interactive picker, or `--connection-id <id>` / `-c <id>`
for a specific one). In non-interactive mode, if `--connection-id` is omitted the CLI prints the
available connections and then errors. Dataverse (`--connector dataverse --as table`) needs no
`--connection-id`. See [connector-reference.md](${CLAUDE_PLUGIN_ROOT}/shared/connector-reference.md).

> **SQL stored procedures** have no `ms app add procedure` command and `--sql-stored-procedure` is not
> accepted by `ms app add data-source`; binding a specific stored procedure is not currently supported.

### Step 4: Shared Connection Policy (`allowedActions`)

**Do this before the build, on every add.** The CLI writes `sharedConnectionId` automatically
when the connection's auth type is shareable, so this can trigger without the user asking for
it — and it doesn't surface as a build error, it surfaces later as a deploy failure.

**4a. Read the config back** and check the reference that was just written. Node 22+ is a
project prerequisite, so this works in bash and PowerShell alike:

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

If it prints `OK`, **skip to Step 5** — the connection isn't shared, or is already covered.

**4b. If it is shared, determine the shape:**

| Reference has…                      | Declare                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| dataset tables (`dataSets`)         | per-table `allowedActions` — every table, from `"get"` / `"post"` / `"patch"` / `"delete"` |
| no dataset tables                   | connector-level `allowedActions` — Action IDs from `ms connector list-actions --connector <api-id> --json` (`id`, `behavior: Allow` only) |

**4c. Infer least privilege, then confirm.** Grep `src/` for calls into the generated service
and map them to values (read/list → `get`, create → `post`, update → `patch`, delete →
`delete`). Present the inferred list and ask the user to confirm or adjust:

> "`<reference>` is a shared connection, so it needs an action policy before deploy. From the
> code, I'd declare `<inferred>`. Anything else it should be allowed to do?"

**Never grant the full set just to pass validation.**

**Deferral — when there is no app code yet.** If `src/` has no calls into this service because
the app hasn't been written yet (the usual case when `/create-app` invokes this skill before
generating the UI), do **not** guess and do **not** prompt. Instead:

- Leave `allowedActions` unset for now. `ms app dev` does not validate it, so local iteration
  is unaffected — only `ms app pack` / `ms app deploy` do.
- Record the reference as **shared, policy pending** in `memory-bank.md`.
- Note it in your summary so the decision happens once the app code exists.

`/deploy` re-runs this same check as a preflight gate, so a deferred policy is caught before it
can reach a failing deploy — not silently forgotten.

**4d. Write the confirmed values into `ms.config.json`** (skip when deferring).

Full rules, worked examples, and failure recovery: [allowed-actions.md](${CLAUDE_PLUGIN_ROOT}/shared/allowed-actions.md).

### Step 5: Build

```bash
npm run build
```

### Step 6: Memory Update

If `memory-bank.md` exists, record `api-id`, mode, parameters used, and — when the reference is
shared — the `allowedActions` that were agreed, so the next session doesn't re-litigate them.

---

## Common Presets

| Wrapper skill        | api-id                          | mode       |
| -------------------- | ------------------------------- | ---------- |
| `/add-dataverse`     | `dataverse`                     | `table`    |
| `/add-sharepoint`    | `shared_sharepointonline`       | `table`    |
| `/add-excel`         | `shared_excelonlinebusiness`    | `table`    |
| `/add-office365`     | `shared_office365`              | `action`   |
| `/add-teams`         | `shared_teams`                  | `action`   |
| `/add-onedrive`      | `shared_onedriveforbusiness`    | `action`   |
| `/add-azuredevops`   | `shared_visualstudioteamservices` | `action` |
| `/add-mcscopilot`    | `microsoftcopilotstudio`        | `action`   |
| `/add-workiq`        | `shared_a365copilotchatmcp`     | `action`   |
