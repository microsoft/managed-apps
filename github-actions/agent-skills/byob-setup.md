# Managed Apps BYOB → GitHub Actions Setup

A step-by-step walkthrough for setting up a new managed apps Bring-Your-Own-Build (BYOB)
deployment pipeline using GitHub Actions. It covers both Dataverse-enabled and
non-Dataverse (DV-free) environments.

This is a plain runbook. Follow it yourself, or hand it to any coding-agent CLI
(GitHub Copilot CLI, Claude Code, etc.) to drive interactively — the guidance
below is written for whoever (person or agent) is driving it.

## How to drive this guide

This is an interactive walkthrough — **not** a doc to dump on the user all at once.

**Pacing rules:**

1. **One question at a time.** Never present multiple prereqs or multiple verification questions at once. After each question, stop and wait for the answer.
2. **Ask each prereq and verification as a clear Yes/No question** (use your CLI's interactive prompt if it has one). Phrase it as the binary check, and include the one-step way to check it inline. Leave room for a "Not sure" / free-text answer.
3. **Branch on the answer.**
   - **Yes**: mark that item done, advance to the next prereq/step.
   - **No**: provide the corrective steps inline (don't just link to docs — give the click path or exact commands), then re-ask.
   - **Not sure / unrelated**: give a one-step check (a portal URL, a single CLI command), then re-ask.
4. **Verify after every step.** Each Step has an explicit "Verification" question — ask it, take the answer, branch.
5. **Don't skip ahead.** Even if the user seems competent, run the prereq gate first. Most failures here are prereqs (env settings, role grants).
6. **Track progress** through the 6 prereqs and 7 steps with a checklist; keep one item in progress at a time.
7. **Keep secrets out of chat.** Never ask the user to paste a client secret, PAT, or JWT into the conversation. Have them paste GUIDs, screenshots, and error messages only.

## Outcome

When all steps complete, every push to the configured branch deploys the managed apps code app to the target Power Platform environment via a Service Principal — no developer machine in the loop.

---

## Prerequisites — ask one at a time, Yes/No format

Do NOT present this as a checklist of 6 items in a single turn. Walk through each as its own question. The "If No" guidance under each item is meant to be delivered when the user answers No or Not sure.

### Prereq 1 — Azure AD permission to create app registrations

Ask: *"Can you create app registrations in your tenant at portal.azure.com? Quick way to check: open portal.azure.com → Microsoft Entra ID → App registrations. Do you see a clickable **+ New registration** button at the top?"*

**If No:**
- The user needs the **Application Developer** role in Microsoft Entra ID (or higher: Cloud Application Administrator, Application Administrator, Global Administrator).
- Click path: tenant admin opens **Microsoft Entra ID** → **Roles and administrators** → searches **Application Developer** → **+ Add assignments** → adds the user.
- Alternative: if the tenant allows users to register apps by default (check **Microsoft Entra ID** → **User settings** → "Users can register applications" = Yes), no role assignment is needed.
- Then re-ask.

### Prereq 2 — Power Platform admin access to the target environment

Ask: *"Do you have admin access to the target Power Platform environment? Quick way to check: open the right PPAC for your ring (admin.powerplatform.com for prod, admin.test.powerplatform.com for test) → Environments → find the env. Can you see a Settings tab when you click into it?"*

**If No:**
- The user needs **System Administrator** on the env (for DV) or **Environment Admin** (for non-DV), OR tenant-wide Power Platform Admin.
- Click path: tenant admin opens https://admin.microsoft.com → **Roles** → **Power Platform Admin** → assign the user.
- Alternative: existing env admin opens the env in PPAC and adds the user as System Administrator (DV) or runs the BAP API to grant Environment Admin (non-DV — see Step 2b in this guide for the API call shape).
- Then re-ask.

### Prereq 3 — GitHub repository for the managed app

Ask: *"Do you have a GitHub repo ready for the managed app, with permission to add repo Settings → Secrets and variables → Actions secrets?"*

**If No:**
- Create one at github.com/new — visibility doesn't matter for this; private is fine.
- Permission: repo Admin or Maintain on the repo lets you manage Actions secrets.
- If the user has Write but not Admin, ask the repo Admin to grant Admin or add the user to a team with Admin.
- Then re-ask.

### Prereq 4 — `AllowExternalArtifactDeployment` enabled on the env

Ask: *"Has your tenant admin enabled `AllowExternalArtifactDeployment` on the target environment? If you're not sure, answer 'not sure' — we can confirm during the smoke test."*

**If No / Not sure:**
- This is a server-side setting; the user typically can't check it directly without running PowerShell.
- Guide: ask the env admin (or run it yourself if you have Power Platform Admin) to enable `AllowExternalArtifactDeployment` on the target environment via PowerShell.
- Symptom if not enabled: `ms app deploy` errors with `External artifact deployment is not enabled for this environment.`
- It's OK to proceed without confirming this right now — we'll catch it at Step 7's deploy if it's still off. But warn the user.

### Prereq 5 — `@microsoft/managed-apps-cli` installed locally (>= 0.7.0)

Ask: *"Run `ms --version` in PowerShell. What does it print?"*

**Branching:**
- Prints `0.7.0` or higher → Yes, continue.
- Prints lower (e.g. 0.6.x) → Update: `npm install -g @microsoft/managed-apps-cli@latest`. Then re-check.
- `ms: command not found` or "not recognized" → Install: `npm install -g @microsoft/managed-apps-cli`. Make sure Node 22+ is installed first (`node --version`). Then re-check.

### Prereq 6 — REST client + `az` CLI (only for non-DV environments)

Ask: *"Is your target environment Dataverse-enabled, or non-DV / DV-free? If you're not sure, default to 'not sure' — we'll confirm in Step 2 and only ask about this prereq if needed."*

**If DV** or **Not sure**: skip this prereq for now.

**If non-DV:**
- Ask: *"Do you have VS Code with the REST Client extension installed AND the `az` CLI working (`az --version` prints something)?"*
- **If No:**
  - REST Client: install VS Code → Extensions → search "REST Client" by Huachao Mao → Install.
  - Alternative: any HTTP client works (curl, Postman, Insomnia, PowerShell `Invoke-RestMethod`). This guide provides a `.http` template optimized for the VS Code REST Client extension.
  - `az` CLI: install from https://learn.microsoft.com/cli/azure/install-azure-cli-windows
  - Re-ask.

---

## Two routing questions before Step 1

Once all prereqs are confirmed, ask these two before starting Step 1:

1. *"Which ring is your target environment — Prod or Test?"* (This sets the `cloud` value in the workflow and the BAP base URL if non-DV.)
2. *"Is the env Dataverse-enabled or non-DV?"* (If they answered "not sure" earlier, give the check from Step 2: PPAC env Details → look for Dataverse database URL.)

Capture both answers and use them throughout the rest of the walkthrough — e.g. set the `cloud:` workflow input automatically, route to Step 2a vs Step 2b without re-asking later.

---

## Step 1 — Create the Service Principal in Azure portal

Walk the user through:

1. Open https://portal.azure.com → **Microsoft Entra ID** → **App registrations** → **+ New registration**
2. Fields:
   - **Name:** something descriptive, e.g. `github-actions-ci-managed-apps`
   - **Supported account types:** *Accounts in this organizational directory only* (single tenant)
   - **Redirect URI:** leave blank
3. **Register**
4. From the new app reg's **Overview** tab, copy and save these values:
   - **Application (client) ID** — this becomes the GitHub secret `PP_SP_CLIENT_ID`
   - **Directory (tenant) ID** — this becomes `PP_SP_TENANT_ID`
   - **Object ID** (App Registration's Object ID) — note this, but **DO NOT use it for role assignment**. There's a separate Service Principal Object ID you'll need in Step 2b.
5. Go to **Certificates & secrets** → **+ New client secret**
   - Description: `github-actions-deploy`
   - Expires: 6–12 months
   - **Add** → **immediately copy the Value** (not the Secret ID). This is the only time you'll see it.
   - This becomes the GitHub secret `PP_SP_CLIENT_SECRET`.

**Verification:** ask the user to paste back (in a private channel — not chat):
- Application (client) ID (full GUID)
- Tenant ID (full GUID)
- Confirm they've saved the client secret value somewhere safe (do **not** paste it)

If any of the three are missing, stop and have them re-do step 4 or 5.

---

## Step 2 — Identify the environment type

The next step **branches**. Ask the user:

> Is the target environment **Dataverse-enabled** (has a Dataverse database) or **non-DV / DV-free** (sandbox SKU with no Dataverse)?

How they can tell:

- Open the env in Power Platform Admin Center. Under **Details**, look for "Dataverse". If it shows a database with a URL like `https://...crm.dynamics.com`, it's **DV**. If it says "Dataverse not provisioned" or shows no Dataverse section, it's **non-DV**.
- Or: if `ms app deploy` errors with messages mentioning Dataverse, application users, or system roles, you're on DV. If errors mention `InvalidDevEnvironmentOperation` or `LinkedEnvironmentForbiddenOperation`, you're likely on non-DV.

Once known, go to **Step 2a** (DV) or **Step 2b** (non-DV). Do **not** mix the two paths — they use different APIs and different role names.

---

## Step 2a — DV environment: add SPN as Application User via PPAC

For Dataverse-enabled environments. Walk the user through:

1. Open the Power Platform Admin Center for the target ring:
   - Prod: https://admin.powerplatform.com
   - Test: https://admin.test.powerplatform.com
2. **Environments** → click on the target environment.
3. **Settings** (top bar) → expand **Users + permissions** → **Application users**.
4. **+ New app user**.
5. In the side panel:
   - Click **+ Add an app**.
   - Search by the Application (client) ID from Step 1.
   - Select the app reg → **Add**.
6. Set **Business unit** to the environment's default business unit (usually the env name).
7. Click the pencil next to **Security roles** → **Add roles** → check **both**:
   - ✅ **System Administrator**
   - ✅ **System Customizer**
   - Click **Save**.
8. **Create**.

**Verification:** ask the user to confirm the new Application User appears in the list with both roles. Common mistakes to flag:
- Choosing the wrong environment (if the same SPN deploys to multiple envs — repeat this step for each)
- Adding only System Customizer (insufficient — needs System Administrator too for managed apps endpoints)
- Adding a user account by accident (the search must resolve to the **app reg**, not a person)

Skip to **Step 3**.

---

## Step 2b — Non-DV environment: assign EnvironmentAdmin via BAP REST API

Non-DV (sandbox-SKU, no Dataverse) environments do **not** show up in PPAC's Application Users UI — there's no Dataverse to host them. Instead, the SPN gets the `EnvironmentAdmin` role via a direct BAP API call.

### 2b.1 — Get the right ObjectId (CRITICAL gotcha)

In Azure AD, every app registration produces **two** objects with different Object IDs:

| Object | Where to find it | Use it? |
|---|---|---|
| App Registration | portal.azure.com → **App registrations** → your app → Overview (the "Object ID" field) | ❌ **NO** |
| Service Principal | portal.azure.com → **Enterprise applications** → your app → Overview (the "Object ID" field) | ✅ **YES** |

The Enterprise Applications page is what shows up when you click the app reg name from the Overview's "Managed application in local directory" link. Both pages display "Object ID" but they're different GUIDs. Using the App Registration's ObjectId in the BAP call below will fail silently or with a confusing error.

Have the user navigate to **Enterprise applications** and capture the **Service Principal Object ID** there. Call it `spnObjectId`.

### 2b.2 — Get an admin user token

The BAP API call must be made with a user token (from someone with `EnvironmentAdmin` on the target env) — the SPN can't grant itself the role.

Easiest path with `az` CLI:

```powershell
az login --tenant <your-tenant-id>
az account get-access-token --resource https://service.powerapps.com/ --query accessToken -o tsv
```

Copy the resulting JWT — call it `userToken`. It's good for ~1 hour.

Alternative: open PPAC in a browser, sign in, open DevTools → Network tab, find any request to `*.api.bap.microsoft.com`, copy the `Authorization: Bearer ...` header value.

### 2b.3 — Identify the right BAP base URL for the ring

| Ring | BAP base URL |
|---|---|
| Prod | `https://api.bap.microsoft.com` |
| Preprod (TIP1) | `https://tip1.api.bap.microsoft.com` |
| Test (TIP2) | `https://tip2.api.bap.microsoft.com` |

### 2b.4 — Use the REST template to grant `EnvironmentAdmin`

Save the following as `grant-spn-environment-admin.http` (works with VS Code REST Client extension). Replace the four `@` values with the user's actual data, then execute the POST.

```http
@baseUrl       = https://tip1.api.bap.microsoft.com
@apiVersion    = 2021-04-01
@tenantId      = <your tenant id GUID>
@envId         = <target environment id GUID>
@spnObjectId   = <SERVICE PRINCIPAL Object ID — from Enterprise Applications, NOT App Registrations>
@userToken     = <Bearer token from `az account get-access-token`>

### Step A — list current role assignments (baseline)
GET {{baseUrl}}/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{{envId}}/roleAssignments?api-version={{apiVersion}}
Authorization: Bearer {{userToken}}
Accept: application/json

### Step B — assign EnvironmentAdmin to the SPN
POST {{baseUrl}}/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{{envId}}/modifyRoleAssignments?api-version={{apiVersion}}
Authorization: Bearer {{userToken}}
Content-Type: application/json

{
  "add": [
    {
      "properties": {
        "roleDefinition": {
          "id": "/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{{envId}}/roleDefinitions/EnvironmentAdmin"
        },
        "principal": {
          "id": "{{spnObjectId}}",
          "type": "ServicePrincipal",
          "tenantId": "{{tenantId}}"
        }
      }
    }
  ],
  "remove": []
}
```

A copy of this template is at [`assets/grant-spn-environment-admin.http`](assets/grant-spn-environment-admin.http) in this guide — point the user there.

**Expected outcome:** Step A returns the existing role assignments (probably one for the env owner). Step B returns 200 / 201 with a body confirming the new assignment for the SPN.

**Verification:** re-run Step A. The SPN should now appear in the response with `EnvironmentAdmin`.

Common failures:
- **400 with "Principal not found"** → wrong ObjectId. Most often: using the App Registration's ObjectId instead of the SP's. Re-check Step 2b.1.
- **403 Forbidden** → the user token lacks `EnvironmentAdmin` on this env. Either get the token from someone who does, or have an admin make you one first.
- **404 environment not found** → wrong `envId` or wrong `baseUrl` for the ring. Make sure they match.

---

## Step 3 — Smoke-test the SPN locally

Same regardless of DV vs non-DV. Have the user run in PowerShell:

```powershell
$secret = Read-Host -AsSecureString "Paste client secret"
$env:MS_CLI_SP_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', $secret).Password

$env:MS_CLI_USE_SP_AUTH  = 'true'
$env:MS_CLI_SP_CLIENT_ID = '<Application (client) ID from Step 1>'
$env:MS_CLI_SP_TENANT_ID = '<Tenant ID from Step 1>'
$env:MS_CLI_CLOUD_INSTANCE = 'test'   # or 'prod', etc.

ms auth status
```

**Expected:**
```
Signed in as Service Principal: <client-id>
```

If you get a 401 or "not signed in": double-check the three SPN env vars (`MS_CLI_SP_CLIENT_ID`, `MS_CLI_SP_CLIENT_SECRET`, `MS_CLI_SP_TENANT_ID`), `MS_CLI_USE_SP_AUTH=true`, and that the secret value is correct and unexpired.

---

## Step 4 — Create the managed app (one-time, locally)

Run **locally as the user** (not as the SPN), because `ms app create` writes scaffolded files to disk and works best interactively.

1. Fresh directory:

   ```powershell
   mkdir my-managed-app
   cd my-managed-app
   ```

2. Switch back to interactive auth:

   ```powershell
   Remove-Item Env:MS_CLI_USE_SP_AUTH      -ErrorAction SilentlyContinue
   Remove-Item Env:MS_CLI_SP_CLIENT_ID     -ErrorAction SilentlyContinue
   Remove-Item Env:MS_CLI_SP_CLIENT_SECRET -ErrorAction SilentlyContinue
   Remove-Item Env:MS_CLI_SP_TENANT_ID     -ErrorAction SilentlyContinue

   ms auth login   # browser opens; sign in as the user with admin on the target env
   ```

3. Set the target cloud instance:

   ```powershell
   $env:MS_CLI_CLOUD_INSTANCE = 'test'   # or 'prod', etc.
   ```

4. Create the app with `--repo none` (BYOB / escape-hatch mode — required for both DV and non-DV):

   ```powershell
   ms app create --display-name "My Managed App" --repo "none"
   ```

   (Operates on the current directory. Add `--force` only if re-scaffolding a
   non-empty directory.)

5. Verify:
   - `ms.config.json` exists with `appId`, `environmentId`, and `repoType: "none"`
   - The Vite template was scaffolded (`package.json`, `src/`, `vite.config.ts`)

6. Install dependencies and test the local build:

   ```powershell
   npm install
   npm run build
   ```

7. Commit and push to GitHub:

   ```powershell
   git init
   git add .
   git commit -m "scaffold managed apps code app"
   git branch -M main
   git remote add origin <your github repo URL>
   git push -u origin main
   ```

---

## Step 5 — Configure GitHub repo secrets

In the GitHub repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add:

| Secret name | Value |
|---|---|
| `PP_SP_CLIENT_ID` | Application (client) ID from Step 1 |
| `PP_SP_CLIENT_SECRET` | Client secret value from Step 1 |
| `PP_SP_TENANT_ID` | Directory (tenant) ID from Step 1 |

---

## Step 6 — Add the GitHub Actions workflow

**Ask the user:** *"What's the path to the app directory inside the repo? (Default `apps/<app-name>` — should match where you ran `ms app create` in Step 4.)"*

Capture the answer as `<app-path>` and use it in both `paths:` and `working-directory:` below.

Create `.github/workflows/deploy-<app-name>.yml` (one file per app — name it after the app so it's obvious which workflow belongs to which app):

```yaml
name: Deploy <app-name>

on:
  push:
    branches: [main]
    paths:
      - '<app-path>/**'                          # only run when THIS app changes
      - '.github/workflows/deploy-<app-name>.yml'  # also re-run if the workflow itself changes
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

    - name: Pack Managed App
      uses: microsoft/Managed-Apps/github-actions/ms-app-pack@v1
      with:
        working-directory: '<app-path>'
        app-id:        ${{ secrets.PP_SP_CLIENT_ID }}
        client-secret: ${{ secrets.PP_SP_CLIENT_SECRET }}
        tenant-id:     ${{ secrets.PP_SP_TENANT_ID }}

    - name: Deploy Managed App
      uses: microsoft/Managed-Apps/github-actions/ms-app-deploy@v1
      with:
        working-directory: '<app-path>'
        cloud: 'test'   # set to the ring of your target env: prod, test
        app-id:        ${{ secrets.PP_SP_CLIENT_ID }}
        client-secret: ${{ secrets.PP_SP_CLIENT_SECRET }}
        tenant-id:     ${{ secrets.PP_SP_TENANT_ID }}
```

**Why this shape:**

- **`paths:` filter** — the workflow only runs when files inside `<app-path>/**` change. In a monorepo with multiple managed apps, edits to other apps don't trigger this one's deploy.
- **`working-directory:` on every step** — `npm install` resolves the right `package.json`; `ms-app-pack` / `ms-app-deploy` find `ms.config.json` in the correct subdirectory. Mismatched paths are the most common workflow setup error.
- **Self-trigger on workflow file changes** — adds the workflow YAML itself to `paths:`. Without this, editing the workflow doesn't trigger a run, which is a confusing dev loop.
- **One workflow file per app** — name the file `deploy-<app-name>.yml`. Mixing multiple apps into one workflow file works but obscures the per-app cloud / SPN config.
- **`ms-app-pack` is optional** — for `repoType: none` apps, `ms-app-deploy` builds and packs internally, so the separate pack step is redundant (it makes the build run twice). Keep it only if you want pack to fail fast as its own step; otherwise drop it and let deploy pack.

**If `<app-path>` is the repo root** (single-app repo, app files in repo root), simplify:
- Remove the `paths:` filter (or use `paths-ignore: ['*.md', 'docs/**']` to skip irrelevant files).
- Remove `working-directory:` from every step.

**If multiple apps share the same SPN but deploy to different envs**, use separate workflow files per app, each with its own `cloud:` value and (if needed) different secret names.

Commit and push the workflow file.

---

## Step 7 — Trigger and verify

1. **Actions** tab → trigger the workflow (automatic on next push, or **Run workflow** for `workflow_dispatch`).
2. Each step should succeed:
   - `install-ms-cli` — installs `@microsoft/managed-apps-cli@latest`
   - `ms-app-pack` (if kept) — runs `npm run build`, prints `App packed. Artifact ready under .ms/packed/.`
   - `ms-app-deploy` — prints `App '<name>' deployed (id: <guid>).` and a Play URL
3. Open the Play URL — app should load.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Service principal environment variables ... must be set` | All three SPN inputs not supplied to a step | Pass `app-id` / `client-secret` / `tenant-id` to **both** `ms-app-pack` and `ms-app-deploy` |
| `npm error code E401 Incorrect or missing password` | Azure DevOps PAT scope or org mismatch | Action uses public npm by default; if overriding `registry-url` to ADO, PAT must match the feed's org and have **Packaging (Read)** scope |
| **DV env:** `Forbidden — 'Repositories.MicrosoftApps.Deploy.Write'` | SPN added as App User but missing managed apps permission | Re-check Step 2a — both System Administrator AND System Customizer assigned. If still failing, contact support for role-to-permission clarification |
| **Non-DV env:** `InvalidDevEnvironmentOperation` or `LinkedEnvironmentForbiddenOperation` from the controller | SPN doesn't have `EnvironmentAdmin` on the env, OR you targeted a DV env and used the non-DV path | Verify with Step 2b's "list role assignments" GET. If the SPN isn't there, retry Step 2b's POST. If the env is DV, switch to Step 2a |
| **Non-DV env:** 400 "Principal not found" on the `modifyRoleAssignments` POST | Used App Registration's ObjectId instead of Service Principal's ObjectId | Re-read Step 2b.1 — get the SP ObjectId from **Enterprise applications**, not **App registrations** |
| `External artifact deployment is not enabled for this environment` | Tenant admin hasn't enabled `AllowExternalArtifactDeployment` | Ask your tenant admin to enable `AllowExternalArtifactDeployment` on the environment via PowerShell |
| `ms.config.json not found in working-directory` | Action's `working-directory` input doesn't point at the app | Set `working-directory` to the path containing `ms.config.json` |
| Workflow runs green but the app doesn't update in the player | Browser cached an older bundle | Hard-refresh; verify the workflow's `commit-sha` output matches the latest commit |

---

## What to do for each new environment

The SPN is a per-tenant resource; **the permission grant is per-environment**. If the same SPN deploys to multiple envs:

- For each DV env → re-do Step 2a
- For each non-DV env → re-do Step 2b
- The workflow can target different envs by changing the `cloud` input (or by using separate apps with different `ms.config.json` files)

## Notable detail — `ms app share` for principal access

After deploy, the user may want to grant edit access to a colleague or another principal:

```powershell
ms app share <principal-objectId> --access edit
```

For BYOB apps (`repoType: 'none'`), this grants contributor access **at the app scope** (since there's no platform-managed repository). The CLI surfaces this automatically: `App ... has no platform-managed repository, so granting contributor access at the app scope instead of repository scope.`

## What this guide does NOT cover

- Federated identity (OIDC) auth — not yet supported by `@microsoft/managed-apps-cli`.
- Multi-stage promotion (dev → test → prod). Build the basic flow first.
- GRS-managed (`--repo native`) or GHE-bound (`--repo <ghe-url>`) flows — different code paths and CI patterns.
