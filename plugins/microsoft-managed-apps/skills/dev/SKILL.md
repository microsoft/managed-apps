---
name: dev
description: Runs a Microsoft App locally with hot reload via `ms app dev`. Use when starting or restarting local development and surfacing the App Player URL.
user-invocable: true
allowed-tools: Read, Grep, Bash, AskUserQuestion
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Local Dev

Starts `ms app dev` in the project's working directory. The CLI runs two servers — a dev script (Vite or equivalent, default port 8080) and a config server — and prints the App Player URL the user opens in their browser.

This skill does NOT deploy to the cloud. For that, use `/deploy`.

## Workflow

1. Memory Bank → 2. Verify Project + Env → 3. Start Dev Server → 4. Hand Off URL

---

### Step 1: Check Memory Bank

Read `memory-bank.md` from the project root (the project the user has `cd`'d into, or the path captured from a prior skill invocation) for context — the app slug/GUID and which environment this project targets — so you can confirm you're starting the right app.

`ms app dev` does **not** need `environmentId` or `appId` passed to it: it runs in the project working directory and reads `ms.config.json` itself. The memory bank is only for orienting yourself; if it's missing, that's fine — skip straight to Step 2.

### Step 2: Verify Project + Env

```bash
test -f ms.config.json || { echo "Not in a Microsoft App workspace (no ms.config.json)."; exit 1; }
```

Probe the CLI binary and confirm auth:

```bash
BIN=ms
$BIN auth status
```

If auth status reports the wrong UPN or is signed out, prompt the user to fix it before continuing (`ms auth login`). Don't try to repair auth silently — wrong-account dev sessions waste time downstream.

### Step 3: Start the Dev Server

Default invocation:

```bash
$BIN app dev
```

Flags worth surfacing (only when the user mentions a need):

| Flag                       | When to use                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `--port <n>` (`-p`)        | Port 8080 is busy. Pick another (e.g., `--port 8081`).                      |
| `--local-app-url <url>` (`-l`) | The user's Vite/dev script is on a non-default URL (default `http://localhost:3000`). |
| `--config-only` (`-C`)     | Only run the config server. Useful when the user runs `npm run dev` separately. |

If the user invoked `/dev` without arguments, run plain `$BIN app dev` first; surface flags only if the run fails.

**Run in the background** (`run_in_background: true`) so the session can continue. Stream stdout via `Monitor` until the line `Ready. You can play your app locally at: <URL>` appears — that's the App Player URL.

### Step 4: Open the Browser and Hand Off the URL

**Open the browser automatically** — run `Start-Process "<captured URL>"` (Windows) or `open "<captured URL>"` (macOS) / `xdg-open "<captured URL>"` (Linux) so the user sees their app immediately without copy-pasting. If the open command fails, fall back to printing the URL.

Print the App Player URL as a **markdown link** so it stays clickable even in narrow terminals. **Also show the URL on its own line** — markdown links can render as plain label text in some environments (e.g. tables), hiding the actual URL from the user.

```
Local dev running — opened the app in your default browser.

Local URL: [Open app in browser](<captured URL>)
           <captured URL>
Stop:      Ctrl+C in the dev terminal (or kill the background task).
Restart:   /dev (from this project folder)
```

Do **not** show the git remote URL in the dev summary — it's an internal detail that confuses users who expect a browser-openable link. The only URL to surface is the App Player URL printed by `ms app dev` (the domain varies by cloud/region — always use the exact URL the CLI outputs, never hardcode the host).

Then add a one-liner reminder of the iterate → preview → deploy loop:

> "The browser tab hot-reloads as I edit code — tell me what to change. Then choose one of these options:
> 1. Keep iterating in local dev (changes load live in the browser).
> 2. Ask to preview (I'll commit + push, then run a cloud preview build in your Microsoft-hosted environment with your IT governance policies).
> 3. Say deploy (I'll commit + push, then explicitly promote a successful build live).
> 4. Say other (I'll stop here with no preview or deploy yet)."

When the user signals readiness, follow the **Ready-to-Ship Gate** in [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md) — commit, push, then present the same 4 options (keep iterating, preview, deploy, or stop here) in that order.

If the dev server prints an error during startup (port conflict, missing `ms.config.json`, expired auth), stop the background task, surface the error verbatim, and propose the targeted fix:

| Error                                                | Fix                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `EADDRINUSE` on 8080                                  | Re-run with `$BIN app dev --port 8081` (or kill whatever's on 8080).                        |
| `ms.config.json not found`                         | The user is in the wrong directory, or this isn't a Microsoft App workspace. Verify and stop. |
| `Authentication failed` (token expired)               | Run `$BIN auth login` (interactive) and retry.                                              |
| `Failed to fetch app metadata for <app-id>`           | App was deleted in the service. Confirm with `$BIN app list --json` and restore or recreate.|

Do NOT push or deploy from this skill, even if the user mentions it mid-session — bounce them to `/deploy` (which requires explicit confirmation).

> **Sharing a cloud preview:** The App Player URL from `ms app dev` is local-only. Once code is pushed to main, use `/play` (`ms app play --mode preview`) to open a cloud-hosted preview URL that works for others without a deploy.