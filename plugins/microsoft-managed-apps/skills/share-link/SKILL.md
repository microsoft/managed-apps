---
name: share-link
description: Manages tenant-wide share links for a Microsoft App via `ms app share link create`, `ms app share link list`, and `ms app share link revoke`. Use when you want to distribute app access via a URL instead of named principals.
allowed-tools: Read Grep Glob Bash AskUserQuestion
---

**📋 Shared Instructions: [shared-instructions.md](../../shared/shared-instructions.md)** — Cross-cutting concerns.

# Share Link

Manages tenant-wide JIT-redemption links for a Microsoft App. The first time a recipient opens a share link they are automatically granted the `Microsoft App Reader` role at the app scope — no explicit principal list required.

Three sub-commands:

| Command | Purpose |
| ------- | ------- |
| `ms app share link create` | Generate a new share link URL |
| `ms app share link list` | List all active share links |
| `ms app share link revoke` | Revoke a link by ID (removes redeemers' access) |

> **Note:** Share links are for distributing *play* access tenant-wide. For granting named users play or edit access, use `/share` instead.

## Workflow

1. Memory Bank → 2. Verify Project + Env → 3. Mode → 4. Run → 5. Surface Result

---

### Step 1: Check Memory Bank

Read `memory-bank.md` per [shared-instructions.md](../../shared/shared-instructions.md) for the app's environment/app identifiers, if recorded.

### Step 2: Verify Project + Env

```bash
test -f ms.config.json || { echo "Not in a Microsoft App workspace."; exit 1; }
BIN=ms
$BIN auth status                                         # must report the expected UPN
```

Both `--app` and `--environment-id` can be supplied explicitly to run from outside a project directory. When `ms.config.json` is present its `appId` and `environmentId` are used automatically.

### Step 3: Mode

Ask the user which operation they want if not already clear from context:

- **create** — generate a new share link.
- **list** — show all active share links.
- **revoke** — delete a share link by ID (also removes access for past redeemers).

### Step 4: Run

#### Create

```bash
$BIN app share link create
```

Flags:

| Flag | Required | Description |
| ---- | -------- | ----------- |
| `--app` | No | App name override. Defaults to `appId` in `ms.config.json`. |
| `--environment-id` / `-e` | No | Environment ID override. Defaults to `ms.config.json`. |
| `--json` | No | Machine-readable envelope: `{ success, appName, appShareLinkId, shareLinkUrl }`. |

On success the CLI prints the share link URL on its own line so it copies cleanly. Capture and present that URL to the user:

```
Share link created for 'my-app' (id: a3f1). Anyone in your tenant who opens
this link will be granted Microsoft App Reader access. Share URL:
https://apps.powerapps.com/play/e/<env-id>/app/<app-guid>?shareLink=a3f1...
```

#### List

```bash
$BIN app share link list
```

Flags: same `--app` / `--environment-id` / `--json` as create. No additional flags.

Human-readable output is a table with columns: `LINK ID`, `ROLE`, `REDEEMERS`, `CREATED BY`. The URL is intentionally omitted from the table — use `--json` if the full URL is needed.

Present the table to the user. If the list is empty, tell them no share links are currently active.

#### Revoke

Before running, show the user what will be revoked:

> "About to revoke share link `<link-id>` for app `<app-name>`. Anyone who has not yet redeemed it will lose access; users who already redeemed it will have their Microsoft App Reader role removed. Continue?"

Wait for explicit yes. Never auto-proceed — this removes access for all past redeemers.

```bash
$BIN app share link revoke --link-id <link-id>
```

Flags:

| Flag | Required | Description |
| ---- | -------- | ----------- |
| `--link-id` / `-l` | **Yes** | The 4-char lowercase hex link ID returned at creation time (e.g. `a3f1`). |
| `--force` / `-f` | No | Skip the CLI's own confirmation prompt. **Always pass `--force` when running non-interactively** because the agent has already asked for confirmation in the previous step. |
| `--app` | No | App name override. |
| `--environment-id` / `-e` | No | Environment ID override. |
| `--json` | No | Envelope: `{ success, appName, linkId, existed: boolean }`. |

If the user has already confirmed, pass `--force` to avoid a double-prompt:

```bash
$BIN app share link revoke --link-id a3f1 --force
```

### Step 5: Surface Result

**Create:** Print the full share URL. Remind the user this grants read-only app access to anyone in the tenant who opens it, and that they can revoke it at any time with `ms app share link revoke --link-id <id>`.

**List:** Present the table. Offer to create or revoke links from here if appropriate.

**Revoke:**
- `existed: true` (or non-JSON success): confirm the link is gone.
- `existed: false` / `404 AppShareLinkNotFound` warning: the link ID was not found — treat as a clean no-op and tell the user.

---

## Edge Cases

| Situation | Action |
| --------- | ------ |
| User doesn't have the link ID for revoke | Run `ms app share link list` first to get the ID, then proceed to revoke. |
| User wants to revoke all links at once | Run `ms app share link list --json`, extract all `appShareLinkId` values, confirm once with the full list, then `revoke --force` each ID in sequence. |
| `ms app share link revoke` warns link not found | Not an error — the link was already gone. Tell the user and continue. |
| Hard error (auth / app-not-found / non-zero exit) | Surface verbatim and STOP. Do not retry. |
| User is outside a project directory | Pass `--app <name>` and `--environment-id <id>` explicitly. Both flags are optional in non-interactive mode when `ms.config.json` is present. |
