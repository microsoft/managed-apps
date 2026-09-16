---
name: list-apps
description: Discovers Managed apps in the active environment via `ms app list --json` and optional `ms app show --json`. Use when listing or locating apps.
user-invocable: true
allowed-tools: Read, Grep, Bash, AskUserQuestion
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# List Apps

Lists apps the active CLI account can see in the active environment, or shows full metadata for a single app.

## Workflow

1. Memory Bank → 2. Verify Env → 3. Mode (list / show) → 4. Output

---

### Step 1: Check Memory Bank

If a project memory bank exists, read it for the app's environment, if recorded, to know which environment the app was created in. Otherwise prompt the user for the environment they want to query (or accept "current default"). Note: `ms app list` reports apps for the signed-in account's resolved environment and has no environment-targeting flag, so the memory bank here is for context/verification — it does not scope the listing.

### Step 2: Verify Env

```bash
BIN=ms
$BIN auth status                                       # confirm the right account
```

The listing scopes to the active environment (the auto-routed Developer environment unless a specific one was targeted at create time).

### Step 3: Mode

Ask (or infer from the user's prompt):

- **list** — enumerate all apps the account can see.
- **show <app-id>** — full metadata for one app (display name, GUID, environment, version, build info, share count, creation/modification dates).

### Step 4: Output

**List:**

```bash
$BIN app list --json
```

Pretty-print the JSON. Default columns when summarizing for the user: `displayName | appId | environmentId | version | lastModified`.

If the list is long (>20 entries), ask the user whether they want to filter (by display-name substring) before printing. The CLI itself returns everything; the filtering happens in this skill.

**Show:**

```bash
$BIN app show --app "$APP_ID" --json
```

Pretty-print the full envelope. Highlight: `appId`, `displayName`, `environmentId`, `version`, `lastDeployedCommit`, `shareCount`, and any `status` fields surfaced by the service.

---

## Useful as a Subroutine

Other skills (`/delete-app`, `/share`, `/deploy`) can invoke this skill to resolve an app GUID from a display-name substring. When invoked as a subroutine, take the search term as `$ARG1` and return only the matching `appId` / `displayName` pairs — skip the interactive prompts.

## Drift Check

After listing, if the user is currently in a project workspace with `ms.config.json`, cross-check the `appId` there against the list:

- **Match found**: confirm the local app exists and surface its current service-side state.
- **No match**: warn the user — `ms.config.json` references an app that doesn't exist (or isn't visible) in the active environment. Likely causes: wrong target environment, the app was deleted, or auth is on the wrong tenant.
