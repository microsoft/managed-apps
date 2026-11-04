---
name: setup-taskmanager
description: Sets up the Task Manager template for a new owner - copies the sample into its own folder, signs in to the `ms` CLI, creates the app and its platform-managed git repository on Copilot Managed Runtime, adds the Azure DevOps, Teams and Office 365 Users connectors, writes .env.local and admins.json, verifies with npm run check-setup, and commits and pushes to the app's repository. Use when someone has just cloned this template, when `npm run dev` or `npm run build` stops at check-setup, or when ms.config.json is missing.
---

# Set up Task Manager

Follow these steps in order. Run every command from this sample's folder (the one that contains
`package.json`), not from the root of the samples repository. Ask the user for values you
don't know (environment, Azure DevOps organization/project); never invent them.

## 1. Prerequisites

- Node.js 24.11 or later, npm and git. Run `npm install` if `node_modules/` is missing.
- The sample in **its own folder**, not inside a clone of the samples repository: that folder
  becomes the app's repository. If `git rev-parse --show-toplevel` succeeds in the sample folder,
  copy the folder out first (for example `cp -r Managed-Apps/samples/TaskManager my-taskmanager`;
  PowerShell: `Copy-Item -Recurse`) and continue from the copy.
- A Power Platform environment where the user may create apps on Copilot Managed Runtime (public
  preview), and its environment ID
  (from the Power Platform admin center or maker portal URL).
- An Azure DevOps organization and project the user can read (and write, to edit work items).
- The Azure DevOps, Teams and Office 365 Users connectors must be allowed in that environment.

## 2. Sign in and pick the account

```bash
npx ms auth login           # opens a browser sign-in
npx ms auth status          # shows cached accounts; the active one is marked
npx ms auth switch          # only if the wrong account is active
```

## 3. Create the app (writes ms.config.json)

The template ships without `ms.config.json`. `ms app init` creates the app, its platform-managed
git repository (set up as `origin`) and `ms.config.json` with the new app's `appId`,
`environmentId` and `"repoType": "native"`:

```bash
npx ms app init --display-name "Task Manager" --environment-id <ENVIRONMENT_ID> --icon-path ./public/task-manager-icon.png
npx ms app set-setting --show-header false   # the app draws its own 95 title bar
```

Don't pass `--repo`: with no git repository in the folder, `init` creates the platform-managed
repository. If the user already has an app for this template, work in a clone of that app's
repository instead of running `init`. Commit `ms.config.json`, `generated/` and `.ms/` to the
app's repository; only `.env.local` stays local (gitignored).

## 4. Add ALL three connectors

The app needs every one of these. Each command creates or reuses a connection and generates
TypeScript into `generated/` (commit it with the app). Add `--use-sso` where the connector
supports single sign-on and the user prefers it; run `npx ms app add data-source --help` if a flag is
rejected (older CLIs call the command `ms app add connector`).

```bash
npx ms app add data-source --connector shared_visualstudioteamservices --as action
npx ms app add data-source --connector shared_teams --as action
npx ms app add data-source --connector shared_office365users --as action
```

Do not edit `generated/`. The app reaches it only through the adapters in `src/connectors/`
(`azureDevOps.ts`, `teams.ts`, `office365Users.ts`).

## 5. Configure .env.local

```bash
cp .env.example .env.local
```

Set at least:

| Variable | Example | Notes |
|---|---|---|
| `VITE_ADO_ORG` | `contoso` | Azure DevOps organization name |
| `VITE_ADO_PROJECT` | `Fabrikam Web` | Azure DevOps project |
| `VITE_ADO_AREA_PATH` | `Fabrikam Web\Team A` | Optional; defaults to the project root |
| `VITE_ADO_AREAS` | `Frontend,Backend` | Optional; sub-areas shown as backlog columns |

Other options (work item types, states, team roster, app URL, issue tracker base URL, Teams message
template, storage provider) are documented in `.env.example` and the README.

## 5b. Choose admins

Ask the installer which usernames should be admins and write them to `admins.json` (sign-in UPN or
email, case-insensitive), for example `{ "admins": ["avery@contoso.example"] }`. Admins see the
Completed, Retrospective, Tags and Bulk edit tabs; an empty list means nobody does. This only hides
UI; Azure DevOps permissions still control what anyone can change. Never add names the installer
didn't give you.

## 6. Verify

```bash
npm run check-setup   # must print "check-setup: ... look good."
npm run typecheck
npm test
```

If `check-setup` reports a missing service or operation, re-run the matching
`npx ms app add data-source` command (or `npx ms app refresh data-source`). If the CLI reported
actions "skipped due to your organization's connector policy" (for example the Azure DevOps
`HttpRequest` action), the environment's data policy removed them: ask an admin to allow them, or
use an environment whose policy allows them, then refresh.

## 7. Run

```bash
npm run dev           # Vite dev server; prints a "Local Play" URL
npx ms app dev        # same thing through the CLI
```

Open the **Local Play** URL to run the app inside the Copilot Managed Runtime player with live
connectors. Check that **My Work** and **Board** load work items, and that the title bar shows the
signed-in user.

## 8. Commit and push

Commit everything and push it to the app's repository (git asks the user to sign in the first
time). Deploy only when the user asks, from a pushed commit: `npm run build`, then
`npx ms app deploy`.

```bash
git fetch origin
git reset origin/main   # start from the new repository's initial commit; your files stay as they are
git branch -M main
git add -A
git commit -m "Set up Task Manager"
git push -u origin main
```

## Data and storage

App-owned data (retro notes, trackers, tags, work-item notes, feedback) uses the **local** storage
provider by default: it stays in each user's browser and is not shared. The title bar says
"Local mode: data stays in this browser". To share it through SharePoint, Dataverse or another
backend, follow `.github/skills/add-data-source/SKILL.md`. Work items always stay in Azure DevOps.

## Done checklist

- [ ] Sample in its own folder; `ms.config.json` exists (from `npx ms app init`, no `--repo`) with real `appId` / `environmentId` values and `"repoType": "native"`
- [ ] All three connectors added; `generated/` and `.ms/` exist
- [ ] `.env.local` sets `VITE_ADO_ORG` and `VITE_ADO_PROJECT`
- [ ] `admins.json` lists the admins the installer chose (or stays empty)
- [ ] `npm run check-setup`, `npm run typecheck` and `npm test` pass
- [ ] `npm run dev` (or `npx ms app dev`) shows live work items
- [ ] Everything committed and pushed to `origin`
