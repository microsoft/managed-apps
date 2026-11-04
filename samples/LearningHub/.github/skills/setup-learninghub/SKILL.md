---
name: setup-learninghub
description: Set up the Learning Hub sample after cloning it - copy it into its own folder, install dependencies, sign in with the ms CLI, create the app and its platform-managed git repository with ms app init (writes ms.config.json), hide the host header, add the Office 365 Users connector, configure .env.local, verify with check-setup, start local development, and commit and push to the app's repository. Use when someone asks to set up, configure, run or deploy this app for the first time, or when `npm run dev`/`npm run build` stops with "Learning Hub is not set up yet".
---

# Set up Learning Hub

Learning Hub is a React + Vite + TypeScript app hosted on Copilot Managed Runtime (public
preview). It uses the public `@microsoft/managed-apps` packages and the `ms` CLI
(`@microsoft/managed-apps-cli`, installed as a dev dependency, so every command below runs through
`npx`). Background: [Quickstart](https://go.microsoft.com/fwlink/?LinkId=2368962) and
[documentation](https://go.microsoft.com/fwlink/?LinkId=2372842).

The sample ships **without** `ms.config.json`; step 3 creates it for your own app. Follow the steps
in order. The app gets its own platform-managed git repository: commit `ms.config.json`,
`generated/` and `.ms/` to it with the rest of the app; only `.env.local` stays local (gitignored).

## 1. Prerequisites

- Node.js 24.11 or later and npm.
- Git 2.27 or later.
- The sample in **its own folder**, not inside a clone of the samples repository: that folder
  becomes the app's repository. If `git rev-parse --show-toplevel` succeeds in the sample folder,
  copy the folder out first (for example `cp -r Managed-Apps/samples/LearningHub my-learninghub`;
  PowerShell: `Copy-Item -Recurse`) and continue from the copy.
- A work account that can create apps in a Power Platform environment, and permission to use the
  **Office 365 Users** connector there.

```sh
node --version
npm install
```

`npm test` and `npm run lint` already work at this point; they don't need the steps below.

## 2. Sign in

```sh
npx ms auth login            # opens a browser; use --device-code on a machine without one
npx ms auth status           # confirm the account and tenant
```

If several accounts are cached, pick one with `npx ms auth switch`.

## 3. Create the app (writes `ms.config.json`)

From this folder run:

```sh
npx ms app init --display-name "Learning Hub"
```

Options (see `npx ms app init --help`):

- `--environment-id <id>` (`-e`) to choose the environment; otherwise the CLI picks or prompts.
- Don't pass `--repo`: with no git repository in the folder, `init` creates the app's
  platform-managed git repository and sets it up as `origin`.
- The defaults for `--build-path` (`./dist`) and `--build-command` (`npm run build`) are correct
  for this app; don't change them.

Check the result with `npx ms app info`. `ms.config.json` must now contain an `appId`, an
`environmentId` and `"repoType": "native"`.

## 4. Hide the host header

The app draws its own top bar, so turn off the host's header:

```sh
npx ms app set-setting --show-header false
```

## 5. Add every required connector

The app needs exactly one connector. Always add it, even if you think it's already there: this is
what generates the `generated/` folder the app compiles against.

| Connector | Connector id | Mode | Used for |
|---|---|---|---|
| Office 365 Users | `shared_office365users` | action | Signed-in user, people search, profiles and photos |

```sh
npx ms app add data-source --connector shared_office365users --as action
```

The CLI asks you to pick or create a connection (use `--connection-id <id>` or `--use-sso` to skip
the prompt; see `npx ms app add data-source --help`). It writes `generated/` and `.ms/`; commit
both with the app. Only `src/connectors/office365Users.ts` imports the generated code. If the CLI reports
actions "skipped due to your organization's connector policy", continue: `npm run check-setup`
(step 7) reports any operation the app needs that is missing.

## 6. Configure `.env.local`

```sh
cp .env.example .env.local     # PowerShell: Copy-Item .env.example .env.local
```

Every variable is optional and documented in `.env.example`. The usual ones to change:
`VITE_APP_NAME`, `VITE_SERIES_NAME`, `VITE_SERIES_DESCRIPTION`, `VITE_SERIES_WEEKDAY`,
`VITE_SERIES_START_TIME`, `VITE_SERIES_END_TIME` and `VITE_SERIES_TIME_ZONE`. Values are baked into
the browser bundle, so never put secrets in them.

## 7. Verify and run

```sh
npm run check-setup      # must print "Setup looks good"
npm run typecheck
npm test
npm run dev              # or: npx ms app dev; open the "Local Play" URL it prints
```

`npm run dev` and `npm run build` run `check-setup` first and stop with these steps if one is
missing.

Then commit everything and push it to the app's repository (git asks you to sign in the first
time):

```sh
git fetch origin
git reset origin/main   # start from the new repository's initial commit; your files stay as they are
git branch -M main
git add -A
git commit -m "Set up Learning Hub"
git push -u origin main
```

## 8. Storage and sharing data

Data is stored **locally in each user's browser by default** (`VITE_STORAGE_PROVIDER=local`). The
app shows a "Local mode" notice, and **Settings and data** offers Export/Import of everything as
JSON. To share sessions and topics between people (SharePoint lists, Dataverse, or your own API),
follow `.github/skills/add-data-source/SKILL.md`. That skill also covers permissions: with a shared
backend, who may edit is enforced by the backend, never by the browser.

## 9. Deploy (when you're ready)

Deploy from a pushed commit:

```sh
npm run build
npx ms app deploy
```

Deploying publishes the app to your environment. Share it with `npx ms app share` (see
`npx ms app share --help`).

## Troubleshooting

- **"Learning Hub is not set up yet"**: read the listed problems; each maps to step 3 or 5.
- **"... is missing operations used by the app"**: re-run step 5 to refresh the generated code.
- **`ms app` commands say the environment or app is invalid**: run `npx ms app info` and re-run
  step 3 if `ms.config.json` is missing or incomplete.
- **Profiles or photos don't load**: check the Office 365 Users connection in the environment and
  that your account can sign in to it.
