---
name: delete-app
description: Deletes a Microsoft App via `ms app delete`. Use when the user asks to delete an app; always require explicit confirmation.
allowed-tools: Read Grep Glob Bash AskUserQuestion
---

**📋 Shared Instructions: [shared-instructions.md](../../shared/shared-instructions.md)** — Cross-cutting concerns. **Two confirmations required; never auto-`--force`.**

# Delete App

Removes the app from the service. The local workspace is NOT deleted by this skill — the user can clean it up afterward (this skill suggests the command but doesn't run it).

## Workflow

1. Memory Bank → 2. Resolve App ID → 3. Verify with Show → 4. First Confirmation → 5. Try Non-Force Delete → 6. If Service Says Force Required: Second Confirmation → 7. Suggest Local Cleanup → 8. Update Memory Bank

---

### Step 1: Check Memory Bank

Read `memory-bank.md` for app slug + GUID + environment.

### Step 2: Resolve App ID

```bash
test -f ms.config.json && APP_ID=$(node -p "require('./ms.config.json').appId" 2>/dev/null) || true
```

If no `ms.config.json`, ask the user for the app slug or GUID. Optionally invoke `/list-apps` to discover.

### Step 3: Verify with Show

Before the destructive call, fetch the app metadata so the user sees what they're about to delete:

```bash
BIN=ms
$BIN app show --app "$APP_ID" --json
```

Display: display name, slug, app GUID, environment, version, creation date, last modified, share count if available.

### Step 4: First Confirmation

> "About to delete the app `<display-name>` (slug `<slug>`, GUID `<guid>`) from environment `<env-name>`. This removes the app from the service for all users — playing the app stops working immediately. Continue?"

Wait for explicit yes. If no, STOP — do not delete.

### Step 5: Try Non-Force Delete

```bash
$BIN app delete --app "$APP_ID" --non-interactive
```

`ms app delete` is idempotent: if the app is already gone (HTTP 204) it emits a warning rather than erroring. Treat both `existed: true` and `existed: false` outcomes as success.

### Step 6: If Service Says Force Required

If the service returns a non-2xx with a message like "delete requires --force" (the app has active shares, child resources, etc.), DO NOT auto-add `--force`. Instead, ask a **second** confirmation:

> "The service requires `--force` to delete this app. Reason from the service: `<verbatim message>`. Adding `--force` will remove the app and any associated state (shares, etc.) immediately. Are you sure?"

Wait for an explicit second yes. Only then:

```bash
$BIN app delete --app "$APP_ID" --force --non-interactive
```

Never short-circuit the two confirmations into one. The service's `--force` requirement is the signal that downstream state will be affected.

### Step 7: Suggest Local Cleanup

After successful delete, surface (do NOT run automatically):

```
App removed from service.

To clean up local workspace:
  cd ..
  rm -rf <project-dir>

Or keep the workspace if you intend to recreate / re-link to a new app.
```

### Step 8: Update Memory Bank

If `memory-bank.md` exists, append a "Deleted" note with the timestamp and the app GUID, but do NOT delete the memory bank itself — the user may want the history.

---

## Failure Modes

| Error                                              | Action                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `App '<id>' not found in environment '<env>'`      | Idempotent path — the app is already gone. Emit a success note and update memory bank (mark deleted).   |
| 403 not authorized                                 | The account doesn't have Owner permissions on the app. Surface the error; suggest `$BIN app share` review or a different account. |
| 5xx from the service                               | Transient. Retry once after 5s; if still failing, STOP and surface verbatim — do not loop.              |
