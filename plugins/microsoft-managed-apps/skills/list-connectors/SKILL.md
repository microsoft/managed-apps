---
name: list-connectors
description: Lists connectors available in the active environment — including whether each is allowed or blocked by your organization's policy — plus the connection-bound data sources already wired into a Microsoft App. Use when discovering connectors and their operations before adding data sources.
user-invocable: true
allowed-tools: Read, Bash, AskUserQuestion
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# List Connectors

Three read-only views, depending on what the user is asking:

1. **What connectors are available, and which are allowed vs blocked by org policy?** → `ms connector list` (lists every connector in the environment with a `Policy Status` of `Allowed` or `Blocked`).
2. **What data sources are already bound to *this* app?** → `ms app show --json` (inspects `ms.config.json`).
3. **What operations does a specific connector expose?** → `ms connector list-actions --connector <id>`, or browse the public reference for available api-ids.

## Workflow

1. Memory Bank → 2. Verify Env → 3. Mode → 4. Run + Present

---

### Step 1: Check Memory Bank

Read `memory-bank.md` for the app's environment, if recorded. This is for context/verification only (confirming you're working against the expected app/environment) — `ms app show --json` and `ms connector list-actions` don't take environment targeting from it and the listing isn't scoped by it.

### Step 2: Verify Env

```bash
BIN=ms
$BIN auth status                                      # confirm the active UPN
```

### Step 3: Mode

Ask (or infer):

- **available**: list connectors available in the environment and whether each is allowed or blocked by org policy (`ms connector list`).
- **app**: enumerate data sources already wired into the current project (requires `ms.config.json` in cwd).
- **connector**: list the operations exposed by a specific connector — useful when planning an `/add-*` invocation.

### Step 4a: Available connectors + policy status

```bash
BIN=ms
$BIN connector list [--search <term>]
```

Output is a table of connectors with a `Policy Status` column (`Allowed` or `Blocked`) and a
`Tabular` column. Use it to confirm a connector is available and **not blocked by your
organization's DLP policy** before planning an `/add-*` invocation. Add `--search <term>` to
narrow a large catalog.

### Step 4b: App-bound data sources

```bash
test -f ms.config.json || { echo "Not in a Microsoft App workspace."; exit 1; }
$BIN app show --json
```

Parse the response for the data-source list and print a summary:

| Connector       | api-id                            | Type     | Name                  |
| --------------- | --------------------------------- | -------- | --------------------- |
| Dataverse       | `dataverse`                       | table    | `contact`             |
| SharePoint Online | `shared_sharepointonline`        | table    | `Project Milestones`  |
| Teams           | `shared_teams`                    | action   | (entire connector)    |

Use this to spot drift (e.g., `ms.config.json` claims a data source that no longer exists in the env).

### Step 4c: Discover operations on a connector

The CLI prompts for / creates connections inline when an `/add-*` skill runs, so users rarely need to look up connection IDs ahead of time. The more useful query is "what can this connector do?":

```bash
$BIN connector list-actions --connector <api-id> [--search <term>]
```

Examples:

```bash
$BIN connector list-actions --connector shared_office365 --search Mail
$BIN connector list-actions --connector shared_sharepointonline --search GetItems
```

Output is a list of operation names and their summaries. Use it to confirm an api-id supports the user's intent before invoking the relevant `/add-*` skill.

---

## When the user wants a connection ID

The CLI creates or reuses connections **inline** while `ms app add data-source` runs — you don't
need a connection ID to start an `/add-*` skill. Two cases need a bit more care:

- **`--non-interactive`**: the CLI can't open a browser or run the SSO flow, so it can't create
  a connection. It expects `--connection-id`. If you omit it, the CLI **first prints the
  available connections** for that connector (Display Name + Connection ID) and **then** errors —
  copy a Connection ID from that table, or discover one via `ms app show --json` (connections
  already bound to the app). If **no** connection exists yet, **run the command once in
  interactive mode** (omit `--non-interactive`) so the CLI creates it inline, then reuse the
  printed Connection ID for subsequent scripted runs.
- **SQL (`shared_sql`)**: each SQL connection points at a different database, so when scripting
  non-interactively pass the `--connection-id` for the right database explicitly.

To **create** a connection that doesn't exist yet, just run `ms app add data-source` interactively:
the CLI handles consent + sign-in (silent SSO, or a browser dialog), creates the connection,
prints its Connection ID, and binds it — no maker portal needed.
