# Managed Apps BYOB → GitHub Actions Setup

Set up a Bring-Your-Own-Build (BYOB) deploy pipeline so every push to your repo
builds and deploys a managed app to a Power Platform environment — no developer
machine in the loop.

**This skill is agent-driven.** Hand it to a coding-agent CLI (GitHub Copilot
CLI, Claude Code, etc.) and it does the work: it creates the service principal,
grants it access to your environment, scaffolds the app, sets your repo secrets,
writes the workflow, and verifies the first deploy. You just answer a few short
questions and sign in when the browser opens.

You *can* also follow it by hand — every automated step has a manual fallback in
a collapsed **Do it manually** block.

---

## For the agent driving this: how it works

You **run the steps yourself** using the user's local `az`, `gh`, and `ms` CLIs.
Only stop to ask the user when you genuinely need something you can't do:
a browser sign-in, a value only they know (env id, ring), or a decision.

**Rules:**

1. **Automate by default.** Prefer running the commands below over handing the
   user a script. Show the user what you ran and the result.
2. **Never put secrets in chat.** The client secret and any token stay in local
   shell variables and go straight into `gh secret set` / the CLI — never
   printed, never pasted into the conversation. GUIDs (app id, env id, tenant
   id) are fine to show.
3. **Ask one question at a time**, only when needed, and wait for the answer.
4. **Verify each step** before moving on; if a command fails, read the error,
   fix it, and retry before advancing.
5. **Track progress** with a checklist; keep one step in progress at a time.

### What you need from the user up front

Ask for these (one at a time, only if you can't discover them yourself):

- **GitHub repo** for the app (e.g. `owner/name`). If they don't have one, offer
  to create it with `gh repo create`.
- **Target environment** — the ring (**Prod** or **Test**) and the
  **environment id** (GUID). If they don't know the id, help them find it in the
  Power Platform Admin Center, or list environments for them.
- **App display name** (e.g. `My Managed App`).

---

## Step 0 — Check the local tools

Run these yourself and confirm each is present:

```powershell
ms --version      # @microsoft/managed-apps-cli — need >= 0.7.0
node --version    # need >= 22
az --version      # Azure CLI
gh auth status    # GitHub CLI, authenticated to the repo host
```

Fixes if missing:

- `ms` missing / too old → `npm install -g @microsoft/managed-apps-cli@latest`
- `az` missing → https://learn.microsoft.com/cli/azure/install-azure-cli
- `gh` missing → https://cli.github.com , then `gh auth login`

Make sure the user is signed in to the right tenant:

```powershell
az login --tenant <tenant-id>
```

> The user needs permission to **create app registrations** in the tenant
> (Entra role *Application Developer* or higher, or the tenant allows app
> registration by default) and **admin** on the target environment. If `az ad
> app create` later fails with an authorization error, that's the missing piece.

---

## Step 1 — Create the service principal (agent-run)

Create the app registration + service principal + a client secret with `az`, and
push the three values straight into the repo's Actions secrets. The secret never
leaves the local shell.

```powershell
$repo   = '<owner/name>'
$appId  = az ad app create --display-name 'github-actions-ci-managed-apps' --query appId -o tsv
az ad sp create --id $appId | Out-Null
$spObjectId = az ad sp show --id $appId --query id -o tsv     # SP Object ID (needed for non-DV grant)
$tenantId   = az account show --query tenantId -o tsv
$secret     = az ad app credential reset --id $appId --years 1 --query password -o tsv

gh secret set PP_SP_CLIENT_ID     --repo $repo --body $appId
gh secret set PP_SP_TENANT_ID     --repo $repo --body $tenantId
gh secret set PP_SP_CLIENT_SECRET --repo $repo --body $secret
Remove-Variable secret
```

Keep `$appId`, `$spObjectId`, and `$tenantId` for later steps. **Do not** print
`$secret`.

**Verify:** `gh secret list --repo $repo` shows all three names.

<details><summary>Do it manually (Azure portal)</summary>

1. portal.azure.com → **Microsoft Entra ID** → **App registrations** → **+ New
   registration**. Name it `github-actions-ci-managed-apps`, single tenant, no
   redirect URI → **Register**.
2. Overview tab → copy **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets** → **+ New client secret** → copy the **Value**
   immediately (shown once).
4. In the repo: **Settings → Secrets and variables → Actions** → add
   `PP_SP_CLIENT_ID`, `PP_SP_TENANT_ID`, `PP_SP_CLIENT_SECRET`.
5. For the non-DV grant you also need the **Service Principal** Object ID — get
   it from **Enterprise applications** (not App registrations) → your app →
   Overview → Object ID.
</details>

---

## Step 2 — Grant the service principal access to the environment

The SPN needs permission on the **specific** environment. The role and API
differ by environment type, so first determine the type.

**Is the target environment Dataverse-enabled or non-DV?** Check the env in the
Power Platform Admin Center → **Details**: a Dataverse database URL
(`...crm.dynamics.com`) means **DV**; "Dataverse not provisioned" / no Dataverse
section means **non-DV**. If unsure, proceed and let a Step 6 deploy error
confirm (`Forbidden ... Deploy.Write` ⇒ DV path needed;
`InvalidDevEnvironmentOperation` / `LinkedEnvironmentForbiddenOperation` ⇒
non-DV path needed).

### Non-DV environment — agent-run

Run the bundled script. It obtains an admin token via `az`, grants
`EnvironmentAdmin` to the SPN through the BAP admin API, and verifies:

```powershell
./assets/grant-spn-environment-admin.ps1 `
  -Ring <Prod|Test> `
  -TenantId $tenantId `
  -EnvId <environment-id> `
  -SpnObjectId $spObjectId
```

It prints `SUCCESS: SPN now has EnvironmentAdmin.` when done. To undo, re-run
with `-Remove`. (Raw REST template, if you prefer:
[`assets/grant-spn-environment-admin.http`](assets/grant-spn-environment-admin.http).)

### DV environment — guided (Application User)

Adding an Application User runs through Dataverse; walk the user through the UI:

1. Power Platform Admin Center (Prod: https://admin.powerplatform.com , Test:
   https://admin.test.powerplatform.com) → **Environments** → the target env.
2. **Settings** → **Users + permissions** → **Application users** → **+ New app
   user**.
3. **+ Add an app** → search by the **Application (client) ID** (`$appId`) →
   **Add**. Set **Business unit** to the env default.
4. **Security roles** → add **both** *System Administrator* and *System
   Customizer* → **Save** → **Create**.

**Verify:** the app user appears in the list with both roles.

---

## Step 3 — Scaffold the app and push it (agent-run)

Create the managed app locally (interactive user auth, not the SPN), build it,
and push to the repo.

```powershell
mkdir <app-dir>; cd <app-dir>

# ensure interactive auth (clear any SP env vars from earlier)
Remove-Item Env:MS_CLI_USE_SP_AUTH,Env:MS_CLI_SP_CLIENT_ID,Env:MS_CLI_SP_CLIENT_SECRET,Env:MS_CLI_SP_TENANT_ID -ErrorAction SilentlyContinue
ms auth login                              # browser opens — user signs in
$env:MS_CLI_CLOUD_INSTANCE = '<prod|test>'

ms app create --display-name '<App display name>' --repo 'none'   # BYOB mode
npm install
npm run build

git init; git add .; git commit -m 'scaffold managed app'
git branch -M main
git remote add origin https://github.com/<owner/name>.git
git push -u origin main
```

**Verify:** `ms.config.json` exists with `appId`, `environmentId`, and
`repoType: "none"`; the build succeeded; the push landed on `main`. (The
`environmentId` here is the env id — use it for the Step 2 grant if you didn't
have it yet.)

---

## Step 4 — Add the deploy workflow (agent-run)

Write `.github/workflows/deploy-<app-name>.yml`. Substitute `<app-path>` (the
app directory inside the repo; `.` if it's the repo root) and the `cloud` value
(`prod` or `test`).

```yaml
name: Deploy <app-name>

on:
  push:
    branches: [main]
    paths:
      - '<app-path>/**'
      - '.github/workflows/deploy-<app-name>.yml'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Setup Node 24
        uses: actions/setup-node@v5
        with:
          node-version: '24'

      - name: Install app dependencies
        working-directory: <app-path>
        run: npm install

      - name: Install ms CLI
        uses: microsoft/Managed-Apps/github-actions/install-ms-cli@v1

      - name: Deploy Managed App
        uses: microsoft/Managed-Apps/github-actions/ms-app-deploy@v1
        with:
          working-directory: '<app-path>'
          cloud: '<prod|test>'
          app-id:        ${{ secrets.PP_SP_CLIENT_ID }}
          client-secret: ${{ secrets.PP_SP_CLIENT_SECRET }}
          tenant-id:     ${{ secrets.PP_SP_TENANT_ID }}
```

Notes:

- If `<app-path>` is the repo root, drop the `paths:` filter and the
  `working-directory:` lines.
- For `repoType: none` apps, `ms-app-deploy` builds and packs internally, so a
  separate `ms-app-pack` step is optional (it just makes the build run twice).
  Add it before deploy only if you want pack to fail fast on its own.
- One workflow file per app; name it after the app so it's obvious which is
  which.

Commit and push the workflow.

---

## Step 5 — Trigger and verify (agent-run)

The Step 4 push triggers the workflow (or use **Run workflow** for
`workflow_dispatch`). Watch it and confirm success:

```powershell
gh run watch --repo <owner/name>
```

**Success looks like:**

- `install-ms-cli` installs `@microsoft/managed-apps-cli@latest`
- `ms-app-deploy` prints `App '<name>' deployed (id: <guid>).` and a Play URL

Open the Play URL — the app should load. From here, every push that touches
`<app-path>` redeploys automatically.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `az ad app create` → authorization error | User lacks app-registration rights | Get the Entra *Application Developer* role, or have an admin create the app reg (manual fallback in Step 1) |
| `Service principal environment variables ... must be set` | SPN inputs not passed to a step | Pass `app-id` / `client-secret` / `tenant-id` to every `ms-app-*` step |
| **DV:** `Forbidden — 'Repositories.MicrosoftApps.Deploy.Write'` | App user missing a role | Re-check Step 2 DV — both *System Administrator* AND *System Customizer* |
| **Non-DV:** `InvalidDevEnvironmentOperation` / `LinkedEnvironmentForbiddenOperation` | SPN lacks `EnvironmentAdmin`, or env is actually DV | Re-run the Step 2 non-DV script; if the env is DV, use the DV path instead |
| **Non-DV:** 400 "Principal not found" | Wrong Object ID | Use the **Service Principal** Object ID (`az ad sp show --query id`), not the App registration's |
| `External artifact deployment is not enabled for this environment` | `AllowExternalArtifactDeployment` off | Ask a tenant admin to enable it on the environment via PowerShell |
| `ms.config.json not found in working-directory` | Wrong `working-directory` | Point it at the folder containing `ms.config.json` |
| Workflow green but app doesn't update | Cached bundle | Hard-refresh; confirm the deployed `commit-sha` matches the latest commit |

---

## Appendix

**Another environment?** The SPN is per-tenant but the grant is per-environment.
Re-run Step 2 for each new env; point the workflow at it via the `cloud` input
(or a separate app with its own `ms.config.json`).

**Share edit access** after deploy:

```powershell
ms app share <principal-objectId> --access edit
```

For BYOB apps (`repoType: 'none'`) this grants contributor access at the app
scope (there's no platform-managed repository).

**Not covered here:** federated identity (OIDC) auth (not yet supported by the
CLI), multi-stage promotion (dev → test → prod), and GRS-managed
(`--repo native`) or GHE-bound flows.
