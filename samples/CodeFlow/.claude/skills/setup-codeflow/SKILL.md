---
name: setup-codeflow
description: Sets up a fresh copy of the CodeFlow sample so it runs as an app hosted on Copilot Managed Runtime — copies the sample into its own folder, signs in with the ms CLI, creates the app and its platform-managed git repository (which writes ms.config.json), applies its settings, adds the GitHub connector, configures .env.local, starts local development, and commits and pushes to the app's repository. Use when someone has just cloned CodeFlow, or when `npm run dev` / `npm run build` stops at "CodeFlow setup is incomplete".
---

# Set up CodeFlow

CodeFlow ships **without** `ms.config.json`, **without** connector code and **without** any
environment identifiers. This skill creates them for the user's own environment. Run every
command from the sample folder (the one that contains `package.json`).

The app gets its own platform-managed git repository. Commit `ms.config.json`, `generated/` and
`.ms/` to it with the rest of the app; only `.env.local` stays local (it is gitignored).

Background: Quickstart https://go.microsoft.com/fwlink/?LinkId=2368962 and documentation
https://go.microsoft.com/fwlink/?LinkId=2372842 for Copilot Managed Runtime (public preview).

## Prerequisites

- Node.js 24.11 or later, npm and git.
- Access to a Power Platform environment where the user can create apps on Copilot Managed
  Runtime.
- A GitHub account the app will act as (the GitHub connector signs in with it).
- The sample must be in **its own folder**, not inside a clone of the samples repository: that
  folder becomes the app's repository. If `git rev-parse --show-toplevel` succeeds in the sample
  folder, copy the folder out first (for example `cp -r Managed-Apps/samples/CodeFlow my-codeflow`;
  PowerShell: `Copy-Item -Recurse`) and continue from the copy.
- Install dependencies once: `npm install`.

Check the installed CLI before using any command below, because flags change between versions:

```bash
npx ms --help
npx ms app init --help
npx ms app add data-source --help
```

## Step 1: Sign in

```bash
npx ms auth login
```

`npx ms auth status` shows cached accounts. Ask the user which environment to use if they have
more than one, and note its environment id.

## Step 2: Create the app

```bash
npx ms app init --display-name "CodeFlow" --icon-path ./public/codeflow-logo.png
```

Don't pass `--repo`: with no git repository in the folder, `init` creates the app's
platform-managed git repository and sets it up as `origin`. Add `--environment-id <id>` to pick
the environment without a prompt. Leave `--build-path` (`./dist`) and `--build-command`
(`npm run build`) at their defaults.

This writes `ms.config.json`. Confirm it contains an `appId`, an `environmentId` and
`"repoType": "native"` (`npx ms app info` shows the app).

## Step 3: Apply app settings

CodeFlow draws its own header, so hide the host header:

```bash
npx ms app set-setting --show-header false
```

## Step 4: Add the GitHub connector (always required)

CodeFlow reads and writes pull requests only through the public **GitHub** connector
(`shared_github`). Add it as an action data source; the CLI prompts for (or creates) a GitHub
connection and generates `generated/`:

```bash
npx ms app add data-source --connector shared_github --as action
```

If the CLI reports actions "skipped due to your organization's connector policy", continue:
`npm run check-setup` (Step 6) reports any operation CodeFlow needs that is missing.

No other connectors are needed. The app uses exactly these GitHub connector operations (least
privilege — do not add others): `GetUser`, `GetPullRequest`, `GetPullRequests`,
`MergePullRequest`, `SearchIssues`, `CompareRepositoryCommits`, `ListCollaborators`,
`checkCollaborator`, `CreateReference`, `CreatePullRequest` and `SearchGithubWithQuery`
(GraphQL queries and mutations for comments, reviews, files, branches and cherry-pick commits).

If the generated service or method names differ from what `src/connectors/github.ts` expects,
adapt **only** that file (it is the single module that imports `generated/`), then run
`npm run typecheck`.

## Step 5: Local configuration

```bash
cp .env.example .env.local
```

All values are optional. Leave `VITE_GITHUB_HOST` at `https://github.com`: the public GitHub
connector this app uses talks to github.com. Set `VITE_APP_URL` to the deployed app URL (from
`npx ms app play`) once the app is deployed, so shared deep links point at it.

## Step 6: Verify and run

```bash
npm run check-setup   # must print "CodeFlow setup looks complete."
npm run typecheck
npm test
npm run dev           # or: npx ms app dev — open the "Local Play" URL it prints
```

## Step 7: Commit and push

Commit everything (including `ms.config.json`, `generated/` and `.ms/`) and push to the app's
repository. Git asks the user to sign in the first time.

```bash
git fetch origin
git reset origin/main   # start from the new repository's initial commit; your files stay as they are
git branch -M main
git add -A
git commit -m "Set up CodeFlow"
git push -u origin main
```

Deploy only when the user asks, from a pushed commit: `npm run build`, then `npx ms app deploy`.

## Storage

By default CodeFlow keeps its own data (seen marks, review notes, app-only approvals,
notes/feedback, settings) in the **browser** (`VITE_STORAGE_PROVIDER=local`), and shows
"Local mode: data stays in this browser". Nothing else is needed for local mode.

To share that data between people or devices (SharePoint lists, Dataverse, your own API), follow
`.github/skills/add-data-source/SKILL.md`. Users can move existing data with
**Settings → Data → Export / Import**.

## Done checklist

- [ ] Sample in its own folder; `ms.config.json` created by `npx ms app init` (no `--repo`), with
  `appId`, `environmentId` and `"repoType": "native"`
- [ ] Host header hidden (`npx ms app set-setting --show-header false`)
- [ ] GitHub connector added; `npm run check-setup` passes
- [ ] `.env.local` created (optional values reviewed)
- [ ] `npm run typecheck` and `npm test` pass
- [ ] `npm run dev` opens the app and the dashboard loads pull requests
- [ ] Everything committed and pushed to `origin`
