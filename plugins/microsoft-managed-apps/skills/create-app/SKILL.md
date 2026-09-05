---
name: create-app
description: Creates Managed apps using React and Vite. Use when scaffolding a new app with `ms app create` and ending on local dev with `ms app dev`.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion, EnterPlanMode, ExitPlanMode, Skill
model: opus
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

**References:**

- [prerequisites-reference.md](./references/prerequisites-reference.md) — Node, git, CLI install, allowedPrompts.
- [troubleshooting.md](./references/troubleshooting.md) — First-run Git Credential Manager trap, common `ms app create` failures.

# Create a Microsoft App

This skill scaffolds a new Microsoft App end-to-end using `@microsoft/managed-apps-cli` (binary `ms`). The default outcome is a **running local dev server**, not a deployed cloud app. Deploying is a separate, explicit user choice via `/deploy`.

## Workflow

1. Memory Bank → 2. Prerequisites → 3. Infer App Spec → 4. Plan → 5. Auth → 6. Environment → 7. Scaffold → 8. Add Data Sources → 9. Implement App → 10. Local Dev → 11. Summary → 12. Memory Bank Update

**Critical principle:** when this skill ends and the user opens the local URL, they must see a **functional app** — connectors wired when required, screens implemented from the approved plan — not a bare template. Adding required data sources and implementing the UI happen **inside this skill**, before `ms app dev` is started. Do not defer them to "next steps."

---

### Step 1: Check Memory Bank

Check for `memory-bank.md` per [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md). If found, infer whether to resume or create a new app from the request: resume when it refers to the existing app or incomplete work; create a new sibling project when it clearly describes a different app. State the choice and continue. Ask only when the request genuinely fits both paths and choosing incorrectly could overwrite or modify existing work.

### Step 2: Validate Prerequisites

Run prerequisite checks **first** — no point gathering requirements if the environment isn't ready. Full details in [prerequisites-reference.md](./references/prerequisites-reference.md).

The commands below are shown in bash syntax. If you are running PowerShell on Windows, use the equivalents described in [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md#shell-compatibility) and the PowerShell example in [prerequisites-reference.md](./references/prerequisites-reference.md) instead of copying the bash snippets literally.

```bash
node --version                                                    # Must be v22+
git --version                                                     # Required (used by `ms app create` to init the repo)
ms --version 2>/dev/null  # Probe the bin name
```

- **Missing Node.js or below v22**: Report "Node.js 22+ is required. Install from https://nodejs.org/ or switch with `nvm use 22`." STOP.
- **Missing Git**: Report "Git is required — `ms app create` initializes a repo. Install from https://git-scm.com/." STOP.
- **Missing `ms`**: proceed to the global install block below. Confirm with the user before running `npm install -g`.
- **One of them resolves**: record which binary name resolved (`$BIN`); use it in every subsequent step.

#### Global install of `@microsoft/managed-apps-cli` (only if `ms` is missing)

Install the CLI **globally** from the public npm registry so the `ms` binary is on PATH.

Ask the user: _"This will install `@microsoft/managed-apps-cli@latest` globally on your machine. OK to proceed?"_ Wait for explicit yes.

Then run:

```bash
# Install globally, pinned to the @latest stable tag.
npm install -g @microsoft/managed-apps-cli@latest

# Re-probe the bin name.
ms --version
```

Record the resolved bin name as `$BIN`.

#### Daily `@latest` refresh check

If `ms` was already installed, compare the local version to the latest published version and offer to upgrade (the `@latest` tag updates regularly):

```bash
INSTALLED=$( ($BIN --version 2>/dev/null) | tr -d '\r' )
LATEST=$(npm view @microsoft/managed-apps-cli@latest version 2>/dev/null | tr -d '\r')

if [ -n "$LATEST" ] && [ "$INSTALLED" != "$LATEST" ]; then
  echo "Installed: $INSTALLED — latest: $LATEST — upgrade recommended."
fi
```

Do not interrupt app creation to offer an optional upgrade. Continue with the installed compatible version and mention the available upgrade in the final summary. Upgrade only when the user explicitly asks for it; never auto-update.

### Step 3: Infer App Spec

**Default to action, not an interview. Ask only when progress is impossible without information that cannot be discovered or safely inferred.**

If the user has not described what they want to build (i.e., `/create-app` was invoked with no arguments or a vague prompt), start with a single open-ended question:

> "What would you like to build? Describe it in your own words — what it does, who uses it, and what problem it solves."

Wait for their answer. Do NOT present a multiple-choice list of app types. Once the app idea is known, infer the rest:

1. **Generate the display name.** If the user already gave a name, use it verbatim. Otherwise derive a short title from the user's prompt (usually 2-5 title-cased words) and use it with `--display-name`. Either way, do not ask the user to name or confirm it. Derive the folder slug from this title.
2. **Plan the complete requested experience.** Include every capability the user clearly describes. Infer the screens, navigation, interactions, and visual styling needed to make those capabilities usable; use a single responsive screen only when it can support the full request cleanly. Do not ask separate questions about layout, theme, or architecture. Present these decisions in the plan for approval.
3. **Infer data needs from user intent.**. Add the appropriate connector whenever the requested experience clearly depends on user, organizational, shared, persistent, or external data, even if the user does not mention a connector. Use local sample data only when the experience is genuinely self-contained or the data intent is unclear. Ask one focused question only when choosing incorrectly would materially change the app.
4. **Discover before asking.** When a connector is needed, infer its api-id and mode from the connector decision guide, and let the CLI discover or create connections where supported. Ask one focused question only if a required tenant-specific identifier cannot be discovered (for example, which of several matching SharePoint lists to use).
5. **Consolidate assumptions into the plan.** Include the generated name, requested capabilities, inferred UI, and any connector choice in one complete plan. Do not ask separate questions to confirm each assumption.

### Step 4: Plan

1. Enter plan mode with `EnterPlanMode`.
2. Design the **complete** implementation approach the user will approve in one shot:
   - Display name (let the CLI resolve the environment automatically; only pass `--environment-id` if the user explicitly provided one).
   - **Each data source to be added** (which `/add-*` skill, api-id, table/list/connection identifiers). These are invoked by Step 8 of this skill — list them as concrete steps, not as "next steps."
   - **App architecture**: components, pages, routing, state management — enough detail that Step 9 can generate the code without re-asking.
   - Build/verify steps and the final `ms app dev` hand-off.
3. Present the complete inferred plan. Include `allowedPrompts` from [prerequisites-reference.md](./references/prerequisites-reference.md) when the host requires them.
4. Once the plan is approved, implement it. Additional questions are allowed only when a required value cannot be inferred or discovered, or when mandated by the safety guardrails (for example, global installation or account switching).

### Step 5: Auth

```bash
$BIN auth status
```

- **Active UPN is correct**: proceed.
- **Wrong UPN**: ask the user whether to keep it or switch. To switch:
  ```bash
  $BIN auth login   # interactive browser flow
  ```
- **Not signed in**: run `$BIN auth login` (interactive).

Treat `auth status` output as the source of truth on every invocation — never assume a cached session is the right account.

### Step 6: Environment

By default, run `ms app create` with **no** environment flags and let the CLI resolve everything automatically. Do not surface the environment concept to the user.

The only exception: **if the user explicitly provides an environment ID, pass it through** as `ms app create --environment-id <env-id>`. Never discover, infer, or construct an environment ID yourself — if the user hasn't given you one, don't pass the flag.

If environment routing fails, surface the actual error to the user rather than attempting an environment workaround (see [troubleshooting.md](./references/troubleshooting.md)).

### Step 7: Scaffold

**If the user explicitly provided a folder name, use it verbatim** — do not generate one, and skip the inference below. Create it as a child of the current directory, unless the current directory is already named that (then set `FOLDER_NAME="."`). If they gave a full path, use that path as-is. Only fall back to a numbered variant if the target already exists, and say so.

Otherwise, derive a folder slug from the display name (lowercase, hyphens, no spaces — e.g. "Sample One" → `sample-one`), then inspect the **current working directory**, including hidden entries, and pick the target:

- **Directory is empty:** set `FOLDER_NAME="."` and scaffold directly into it. Do not ask for a path or app name.
- **Current directory is a Microsoft App root** (it contains `ms.config.json`): never scaffold inside it — that would nest an app and a Git repository inside another one. Create the new app as a **sibling**, so `FOLDER_NAME` is the slug under the parent directory (e.g. `../sample-one`).
- **Any other non-empty directory:** use the slug as a child folder.

In both non-empty cases, if the chosen path already exists, select the first available numbered variant (`sample-one-2`, `sample-one-3`, etc.); never overwrite an existing directory. State the chosen location and continue immediately without asking for confirmation, e.g. _"Found current folder is not empty. I'll create the app in: `<FOLDER_NAME>`."_ — or, for the sibling case, _"This folder is an existing Microsoft App, so I'll create the new app alongside it in: `<FOLDER_NAME>`."_

```bash
$BIN app create "$FOLDER_NAME" \
  --display-name "$DISPLAY_NAME" \
  --non-interactive
# Append --environment-id "$ENV_ID" ONLY if the user explicitly provided an environment ID (see Step 6).
```

After the command succeeds, enter the target directory unless it is `.`, then set `PROJECT_ROOT`:

```bash
[ "$FOLDER_NAME" = "." ] || cd "$FOLDER_NAME"
PROJECT_ROOT="$(pwd)"
```

Now that `PROJECT_ROOT` exists, write the approved plan to `$PROJECT_ROOT/app_generated_plan.md` per [planning-policy.md](${CLAUDE_PLUGIN_ROOT}/shared/planning-policy.md) — before any implementation, so it is committed with the rest of the generated app.

Capture from the output: the app GUID, the environment ID/name resolved by the CLI, and the remote git URL. (The environment ID appears in the App Player URL and is needed for that link — it's an internal detail, not something to surface to the user.)

#### First-run Git Credential Manager recovery

On the **first ever** `ms app create` for a fresh account (or after the GCM cache expires for the relevant remote), the local-setup step fails with:

```
fatal: Authentication failed for 'https://<env-id>.d.environment.api.powerplatform.com/appframework/git/repositories/<repo-guid>/'
Could not commit and push the initial scaffold. Your app and local scaffold are ready.
```

The CLI installed a `[credential ...]` block in `.git/config`, but GCM still needs an interactive browser flow once. The app and scaffold are already created; do **not** delete the app or rerun `ms app create`.

**Recovery sequence** (the app exists in the service but is empty locally):

```bash
cd "$PROJECT_ROOT"
git fetch origin # browser opens; approve.
```

Detect this by matching `Could not commit and push the initial scaffold` together with `Authentication failed for 'https://...d.environment.api...'`, or `push.success: false` in `--json` output. Surface `git fetch origin` and continue with the existing app after it succeeds.

### Step 8: Add Data Sources

For every connector identified in Step 3 / Step 4, invoke the matching skill **now**, in this session, before any UI code is generated:

- A specific `/add-*` skill when one exists (`/add-dataverse`, `/add-sharepoint`, `/add-excel`, `/add-office365`, `/add-teams`, `/add-onedrive`, `/add-azuredevops`, `/add-mcscopilot`, `/add-workiq`).
- `/add-data-source` (with api-id) for anything else.

For Work IQ knowledge/search scenarios, prefer `/add-workiq` (maps to `shared_a365copilotchatmcp`) over generic `/add-data-source`.

Run them sequentially. After each one:

- Confirm the typed services were generated under `generated/` at the project root. The add-* skills regenerate TypeScript clients.
- **For implementation guidance**, refer to the specialized skill's documentation:
  - `/add-office365` → See "Office 365 Connector: Method Selection Guide" for correct import paths, calendar discovery, and API patterns
  - `/add-workiq` → See "Work IQ Integration: MCP Session Pattern" for session management and response parsing
  - Other `/add-*` skills have similar guidance
- Capture the connection ID + service path so Step 9 can import them.

**Forward all captured context to each sub-skill so its own gather-info prompts are suppressed.** The per-service skills (`/add-dataverse`, `/add-sharepoint`, etc.) and `/add-connector` each have their own prompt sequences (pick connection, pick table/list/site, choose api-id, etc.). The approved plan and discovery results should contain those answers, so pass them through as `$ARGUMENTS` (or whatever invocation surface is available) when dispatching: api-id, connection ID or name, table/list/site identifiers, environment URL, and the project root. If a sub-skill still needs a required input that cannot be discovered or safely inferred, ask the user one focused question and record the answer as an amendment to the approved plan rather than letting multiple sub-skills ask interactively.

The intent of this step is no per-connector approval prompts: the approved plan from Step 4 covers them. If a sub-skill fails (auth, missing connection, wrong api-id), surface the error verbatim and stop; do not silently proceed with a half-wired app.

If Step 3 / Step 4 identified zero data sources, skip this step. Otherwise, this step must complete before Step 9 starts.

### Step 9: Implement the App

Generate the code that delivers the experience described in the approved plan:

- Components, pages, routing, state management.
- Wire each component to the typed services produced in Step 8 (no raw `fetch` / `axios` / Graph calls — see [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)).
- Apply the inferred theme and UI decisions documented in the approved plan.
- Replace template placeholder content; the user must see *their* app at the local URL, not "Hello World."

When the implementation is complete, the next step's `npm run build` is the gate that proves everything compiles end-to-end.

### Step 10: Build and start local dev

```bash
npm install            # safe to re-run; idempotent.
npm run build          # verifies the scaffolded + connector + custom code all compile.
$BIN app dev           # starts the dev server (default port 8080) + config server.
```

If `npm run build` fails, fix the errors before running `ms app dev`. Don't hand the user a URL that points at a broken build.

`ms app dev` runs two servers and prints an App Player URL like:

```
Ready. You can play your app locally at: https://play.<cloud-domain>/apps/dev?ms_appUrl=http%3A%2F%2Flocalhost%3A5173%2F&ms_appConfigUrl=http%3A%2F%2Flocalhost%3A<port>
```

The domain varies by cloud/region (e.g. `play.preview.managedapps.cloud.microsoft.com`, `play.managedapps.cloud.microsoft.com`, or a sovereign-cloud equivalent). **Always use the exact URL the CLI prints** — do not hardcode or rewrite the host.

Hand that URL to the user **as a markdown link** (`[Open app in browser](<url>)`) **and also print the raw URL on its own line** — markdown links can render as plain label text in some environments (e.g. tables), hiding the actual URL. **Then open the browser automatically** using `Start-Process` (Windows) or `open` (macOS) / `xdg-open` (Linux). **Nothing has been deployed to the cloud at this point** — the app exists in the service catalog but its runtime is local, with the connectors and UI you just built wired up.

The dev server runs in the foreground. Either:
- Keep it running and tell the user how to stop it (Ctrl+C) and restart (`ms app dev`).
- Or, if the user wants to continue iterating in the same Claude/Copilot session, run `ms app dev` in the background (`run_in_background: true`) and monitor for the App Player URL line.

### Step 11: Summary

Provide:

- **App**: display name, app GUID.
- **Project path**: `$PROJECT_ROOT`.
- **Git remote URL** (label it "Git Remote", not just "Remote" — users confuse "Remote" with a browser-openable link).
- **Connectors wired up**: list each one added in Step 8 + which screens use it.
- **App Player URL** (local dev) as a markdown link **and** the raw URL on its own line — markdown links can render as plain label text in some environments, hiding the actual URL.
- **Open the browser automatically** after printing the URL — don't wait for the user to copy-paste it.
- **What this URL is**: a live preview of the running app. Edits made in this chat will hot-reload there in real time — the user does **not** need to restart anything to see changes.
- **Next steps** (in this exact framing):
  1. Tell me what to change — I'll edit the code and you'll see it update live in the browser.
  2. When you're happy with how it looks and behaves, say so. I'll commit + push your changes, run `ms app play --mode preview` to give you a cloud preview URL hosted in your environment, and *then* ask if you want me to `/deploy` to the live URL.
- **Important**: explicitly note that **nothing has been deployed to the cloud yet** — current state is local dev only.

When the user signals readiness, follow the **Ready-to-Ship Gate** in [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md) — commit, push, `ms app play --mode preview`, hand off the preview URL, then ask about `/deploy`. Do not skip the preview gate.

Do **not** list `/add-*` skills as next steps here; data sources were already wired in Step 8. (If the user later wants an additional connector, they can ask and you'll invoke the right `/add-*` mid-iteration.)

### Step 12: Update Memory Bank

Write `memory-bank.md` at `$PROJECT_ROOT/memory-bank.md` per [memory-bank.md](${CLAUDE_PLUGIN_ROOT}/shared/memory-bank.md) template. Record the environment ID the CLI resolved for reference (e.g. to reconstruct the App Player URL) — do not use it to re-target a future `ms app create`, and do not surface it to the user.

---

## Example Walkthrough

**User request:**

> "Build me a hello-world Microsoft App called Sample One."

**Commands run (in order, against an account with `ms` already installed and authenticated to the production cluster):**

```bash
# Step 2: Prerequisites
node --version                       # → v22.4.0
git --version                        # → 2.45.0
ms --version                         # → 0.3.x

# Step 5: Auth
ms auth status                       # → signed in as alice@contoso.onmicrosoft.com

# Step 7: Scaffold (run from any directory; CLI creates the subfolder)
pwd                                 # → /Users/alice/work
ms app create sample-one \
  --display-name "Sample One" \
  --non-interactive
# → App created. AppId: 7ea6...
# → Environment: Default-<guid> (auto-routed)
# → Remote: https://<env-id>.d.environment.api.powerplatform.com/...
cd sample-one

# Step 8: Add Data Sources (none in this hello-world example — skipped)

# Step 9: Implement App (template-only for hello-world; nothing to wire)

# Step 10: Build and start local dev
npm install
npm run build
ms app dev
# → Ready. Play locally at: https://play.<cloud-domain>/apps/dev?ms_appUrl=...
```

**Final summary (verbatim format):**

```
Sample One is running locally.

App: Sample One
App GUID: 7ea6...
Environment: Default-<guid> (auto-routed Developer environment)
Cluster: prod
Project: /Users/alice/work/sample-one
Git Remote: https://<env-id>.d.environment.api.powerplatform.com/...
Local URL: [Open app in browser](<URL from ms app dev output>)
           <URL from ms app dev output>

Nothing has been deployed to the cloud. The app (with its connectors and UI
already wired up) runs from your machine via `ms app dev`. The browser tab
hot-reloads as I make code changes — just tell me what to adjust.

When you're happy with it, tell me. I'll commit + push your changes, run
`ms app play --mode preview` to give you a cloud preview URL in your
environment, and then ask if you want me to /deploy.
```
