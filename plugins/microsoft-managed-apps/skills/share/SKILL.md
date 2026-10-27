---
name: share
description: Shares (or unshares) a Microsoft App with users via `ms app share` / `ms app unshare`. Use when updating app access control.
allowed-tools: Read Grep Glob Bash AskUserQuestion
---

**📋 Shared Instructions: [shared-instructions.md](../../shared/shared-instructions.md)** — Cross-cutting concerns. **Always confirm before share/unshare.**

# Share / Unshare

Adds or removes user access to the app in the current directory. The CLI resolves emails via Microsoft Graph; entries that don't resolve are returned as warnings (the RP call still succeeds for the resolved entries).

## Workflow

1. Memory Bank → 2. Verify Project + Env → 3. Mode (share / unshare) → 4. Collect Emails → 5. Confirm → 6. Run → 7. Surface Partial-Success Envelope

---

### Step 1: Check Memory Bank

Read `memory-bank.md` for app slug, GUID, and environment.

### Step 2: Verify Project + Env

```bash
test -f ms.config.json || { echo "Not in a Microsoft App workspace."; exit 1; }
BIN=ms
$BIN auth status                                         # must report the expected UPN
```

### Step 3: Mode

Ask whether the user wants to **share** (add access) or **unshare** (remove access). Default to share unless the prompt obviously indicates removal.

### Step 4: Collect Emails

Accept a comma-separated email list. Validate basic shape (`user@domain`) before passing through; don't try to resolve them yourself — `ms` handles Graph resolution and will return warnings for unresolved entries.

If the user passes Object GUIDs (already-resolved principals), pass them through as-is — the CLI accepts both forms.

### Step 5: Confirm

Show the user exactly what will run, then ask for confirmation:

> "About to **share** `<app-name>` with: `alice@contoso.com, bob@contoso.com`. Confirm?"

Wait for explicit yes. Never auto-proceed — ACL changes affect production users.

### Step 6: Run

**Share:**

```bash
$BIN app share "alice@contoso.com,bob@contoso.com"
```

**Unshare:**

```bash
$BIN app unshare "alice@contoso.com,bob@contoso.com"
```

The command reads the app ID from `ms.config.json`.

### Step 7: Surface Partial-Success Envelope

The CLI returns a JSON envelope with `partialFailure: boolean` and `warnings: []`. When `partialFailure: true`:

- The RP call succeeded — share state is updated for resolved users.
- Warnings list the unresolved entries (typo'd email, account doesn't exist in the tenant, Graph couldn't find them, etc.).

Print warnings verbatim and ask the user whether to re-run with corrected entries:

```
Share completed with warnings:
  - 'bob@contso.com' could not be resolved (Graph returned 404).
  - 'charlie@partner.com' is not a member of this tenant.

Share state updated for: alice@contoso.com (1 of 3 resolved).

Would you like to retry the 2 unresolved entries with corrections?
```

If the user confirms, loop back to Step 4 with the corrected list. Don't retry automatically — typos and tenant-membership issues need human resolution.

---

## Edge Cases

| Situation                                                       | Action                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| User passes a single email                                       | Run as-is; the envelope still applies (just with one entry).                                                   |
| User passes a mix of emails and Object GUIDs                     | Pass through as one comma-separated list — the CLI accepts both.                                               |
| `ms app share` returns non-zero (not a partial-failure envelope) | A hard error (auth, env, app-not-found). Surface verbatim and STOP. Do not retry.                              |
| User says "share with everyone"                                  | Decline — there is no "everyone" semantic. Ask for an explicit list.                                            |
