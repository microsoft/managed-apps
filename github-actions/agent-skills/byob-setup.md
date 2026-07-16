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

1. **One question at a time.** Never present multiple checks or multiple verification questions at once. After each question, stop and wait for the answer.
2. **Ask each check and verification as a clear Yes/No question** (use your CLI's interactive prompt if it has one). Phrase it as the binary check, and include the one-step way to check it inline. Leave room for a "Not sure" / free-text answer.
3. **Branch on the answer.**
   - **Yes**: mark that item done, advance to the next step.
   - **No**: provide the corrective steps inline (don't just link to docs — give the click path or exact commands), then re-ask.
   - **Not sure / unrelated**: give a one-step check (a portal URL, a single CLI command), then re-ask.
4. **Verify after every step.** Each Step has an explicit "Verification" question — ask it, take the answer, branch.
5. **Check requirements just-in-time.** There's no separate prereq gate — each step opens with a **Needs** line stating what it requires (a role, a tool, access). Don't skip those inline checks; most failures are permissions or env settings.
6. **Track progress** through the 7 steps with a checklist; keep one item in progress at a time.
7. **Keep secrets out of chat.** Never ask the user to paste a client secret, PAT, or JWT into the conversation. Have them paste GUIDs, screenshots, and error messages only.

## Outcome

When all steps complete, every push to the configured branch deploys the managed apps code app to the target Power Platform environment via a Service Principal — no developer machine in the loop.

---

## Before you start

There's **no separate prerequisites checklist** — each step checks what it needs, when it needs it. Confirm two things up front, then go:

1. **Signed in.** The user is signed in to the target tenant. (`az account show` if they'll use `az`; the browser sign-in in the later `ms` steps covers the rest.)
2. **Two routing answers** that shape the rest of the guide — ask these now and reuse them:
   - *"Which ring is the target environment — Prod or Test?"* → sets the `cloud:` workflow input and, if non-DV, the BAP base URL.
   - *"Is the environment Dataverse-enabled or non-DV / DV-free?"* → routes Step 2 to **2a** (DV) or **2b** (non-DV). If unsure, the check is in Step 2.

Everything else — app-registration rights, environment admin, the `ms` CLI, repo secret access, `AllowExternalArtifactDeployment` — is verified inline at the step that needs it, called out in a **Needs** line.

---

## Step 1 — Create the Service Principal in Azure portal

**Needs:** permission to create app registrations in the tenant — the Entra **Application Developer** role (or higher), or a tenant that allows users to register apps by default (**Microsoft Entra ID → User settings → "Users can register applications" = Yes**). If the user can't see a **+ New registration** button at **portal.azure.com → Microsoft Entra ID → App registrations**, have a tenant admin assign **Application Developer** (Entra ID → Roles and administrators), then continue.

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

**Needs:** admin on the target environment — **System Administrator** (DV) or **Environment Admin** (non-DV), or tenant-wide **Power Platform Admin**. Quick check: open the env in PPAC (admin.powerplatform.com for prod, admin.test.powerplatform.com for test) and confirm a **Settings** tab is visible. If not, have a tenant admin grant Power Platform Admin (admin.microsoft.com → Roles), or an existing env admin add the user (System Administrator for DV; the Step 2b grant for non-DV).

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

**Needs:** the `az` CLI working (`az --version`) so the grant script can fetch an admin token. (A REST client — VS Code REST Client, curl, Postman — is only needed if you use the manual `.http` alternative in 2b.4 instead of the script.)

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
| Test (TIP2) | `https://tip2.api.bap.microsoft.com` |

### 2b.4 — Grant `EnvironmentAdmin` to the SPN

**Automated (recommended).** This is the one step the driving agent can run for the user. Once the user has supplied the ring, tenant id, environment id, and the **Service Principal** Object ID (from Step 2b.1), run the bundled script — it acquires an admin token via `az`, does the baseline GET + grant POST, and verifies:

```powershell
./assets/grant-spn-environment-admin.ps1 `
  -Ring <Prod|Test> `
  -TenantId <tenant id GUID> `
  -EnvId <environment id GUID> `
  -SpnObjectId <SP Object ID>
```

It prints `SUCCESS: SPN now has EnvironmentAdmin.` when done (re-run with `-Remove` to undo). The user only provides the four values; the admin token is fetched locally by the script and never enters the chat. If `az` isn't signed in, have the user run `az login --tenant <tenant id>` first.

**Manual alternative (VS Code REST Client).** Save the following as `grant-spn-environment-admin.http`. Replace the four `@` values with the user's actual data, then execute the POST.

```http
@baseUrl       = https://tip2.api.bap.microsoft.com
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

## Step 2c — Enable external artifact deployment on the environment

**Needs:** **Environment Admin** on the target environment (you have it from Step 2), **PowerShell 7**, and a delegated user token captured from a live **Power Platform Admin Center (PPAC)** browser session. Do this **now**, before the first deploy, so you don't discover it via a failed CI run. It doesn't block Steps 3–6, but it **must** be on before Step 7.

BYOB / escape-hatch apps (`repoType: none`, created in Step 4) upload an **external artifact** — a bundle built outside a platform-managed repo. Environments reject those by default. Until the environment setting `MicrosoftApps_AllowExternalArtifactDeployment` is `true`, **every** `ms app deploy` (local or CI) fails with:

```
External artifact deployment is not enabled for this environment.
To enable it, contact your administrator to turn on the
AllowExternalArtifactDeployment environment setting.
```

This is **not** exposed by `pac`, `ms`, or the BAP environment object. It's flipped via a `PATCH` to the Power Platform **Environment Management API**. There's no fully-automated path: Azure CLI can't mint the required scope (`AADSTS65002`), so you capture a delegated token from PPAC.

1. **Get the environment id** from PPAC (or Step 2).
2. **Pick the ring-aware API endpoint** (if unsure, find it in F12 → Network on any PPAC page that calls `api.*.powerplatform.com` — see step 3):

   | Ring | API endpoint |
   |---|---|
   | Production | `https://api.powerplatform.com/` |
   | Test | `https://api.test.powerplatform.com/` |

   > _Microsoft-internal:_ non-production rings follow the same pattern
   > (`https://api.<ring>.powerplatform.com/`). External customers use **Production**.

3. **Capture the token** (a delegated user token for the `api.*.powerplatform.com` audience): open **admin.powerplatform.com** → **F12 → Network**, clear logs, then trigger any call to `api.*.powerplatform.com` — for a **DV env** open the environment's **Settings → Features**; for a **non-DV env** (no Settings page) just open the environment or let the **Environments** list load. Filter by `api.*.powerplatform.com`, open any request (e.g. `/settings?api-version=` or `/environments`), and copy the `authorization` header value (the part **after** `Bearer `). Tokens last ~90 min; treat them as secrets — never commit them.
4. **Set it** with the helper at [`assets/set-allowexternalartifactdeployment.ps1`](assets/set-allowexternalartifactdeployment.ps1) (PowerShell 7):

   ```powershell
   . ./assets/set-allowexternalartifactdeployment.ps1

   $token = Read-Host -AsSecureString "Paste the PPAC bearer token (Value only, no 'Bearer ' prefix)"
   Set-MicrosoftAppsAllowExternalArtifactDeployment `
     -Token $token `
     -Env '<environment id>' `
     -ApiEndpoint 'https://api.test.powerplatform.com/' `   # match your ring
     -AllowExternalArtifactDeployment $true
   ```

   Pass `$false` to disable or `$null` to clear it (three-state setting).

**Verification:** read it back with the companion `Get-MicrosoftAppsAllowExternalArtifactDeployment` (same file) — it should return `True`. A successful Step 7 deploy (no *"external artifact deployment is not enabled"* error) is the end-to-end confirmation.

> Common token errors: `Forbidden` / `InsufficientDelegatedPermissions` → token came from Azure CLI, capture from PPAC instead; `AuthorizationHeaderInvalid` / `SignatureKeyNotFound` → token expired, re-capture; `404 Not Found` on the `$select` → the setting isn't deployed to that ring/environment yet.

---

## Step 3 — Smoke-test the SPN locally

**Needs:** `@microsoft/managed-apps-cli` installed locally, version **>= 0.7.0** (`ms --version`). If it's missing or older, install/update with `npm install -g @microsoft/managed-apps-cli@latest` (Node 22+ required — `node --version`), then continue.

Same regardless of DV vs non-DV. Have the user run in PowerShell:

```powershell
$secret = Read-Host -AsSecureString "Paste client secret VALUE"   # the Value, NOT the Secret ID
$env:MS_CLI_SP_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', $secret).Password

$env:MS_CLI_USE_SP_AUTH  = 'true'
$env:MS_CLI_SP_CLIENT_ID = '<Application (client) ID from Step 1>'
$env:MS_CLI_SP_TENANT_ID = '<Tenant ID from Step 1>'
$env:MS_CLI_CLOUD_INSTANCE = 'test'   # or 'prod', etc.

# `ms auth status` is interactive-only and does NOT work under SP auth.
# Verify SP auth by running a real read command instead:
ms app list --environment-id <target environment id> --non-interactive
```

**Expected:** the command returns the list of apps (or `No apps found.` on an empty env) — either way, the SPN authenticated successfully.

If it fails:
- `AADSTS7000215: Invalid client secret provided` → you pasted the secret **ID**, not the secret **Value**. Copy the **Value** column in Certificates & secrets (only shown at creation — make a new secret if you lost it) and re-set `MS_CLI_SP_CLIENT_SECRET`.
- 401 / other auth error → double-check the three SPN env vars (`MS_CLI_SP_CLIENT_ID`, `MS_CLI_SP_CLIENT_SECRET`, `MS_CLI_SP_TENANT_ID`), `MS_CLI_USE_SP_AUTH=true`, and that the secret is current and unexpired.

To get the Application (client) ID without copying from the portal, resolve it from the SP Object ID: `az ad sp show --id <sp-object-id> --query appId -o tsv`.

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

3. Set the target cloud instance so `ms app create` targets the right ring:

   ```powershell
   $env:MS_CLI_CLOUD_INSTANCE = 'prod'   # the ring your environment lives in
   ```

   > **Microsoft-internal only.** On non-production rings you must also pin the exact
   > environment with the internal debug override below. External customers skip this —
   > the CLI targets the environment you're signed into.
   >
   > ```powershell
   > # Internal, non-prod rings only. Use the environmentId **GUID** (PPAC → Environment →
   > # Details, or the deploy error text) — NOT the 'Default-<guid>' name form, which returns
   > # `EnvironmentNotFound` from the appframework API.
   > $env:MS_CLI_MAAF_DEBUG_ENVIRONMENT_ID = '<your-environmentId-guid>'
   > ```

   If you're on an internal non-prod ring and skip the override, the CLI may target the wrong (default) environment, and the later deploy fails against an environment where you never enabled `AllowExternalArtifactDeployment` (Step 2c) or granted the SPN.

4. Create the app with `--repo none` (BYOB / escape-hatch mode — required for both DV and non-DV):

   ```powershell
   ms app create --display-name "My Managed App" --repo "none"
   ```

   > **The directory MUST be empty.** `ms app create` refuses a populated directory,
   > and there is **no `--force` flag** to override this (only `--force-reauth`, which
   > is unrelated). Just as important: `ms app init` can only register a **`native`**
   > (platform-managed GRS) or **`github`** app — it can **never** produce `repoType: none`.
   > So the *only* way to get a BYOB/external-build app is `ms app create --repo none` in an
   > empty dir. **Do not** hand-edit `repoType` from `native` to `none` in an existing
   > `ms.config.json` — the server-side app record stays native and the deploy fails with
   > `GitOperationsNotSupportedForNonExternalBuildRepo`. To convert an existing populated
   > project, scaffold a fresh app with `create --repo none` in an empty dir, then move your
   > source in alongside the CLI-generated `ms.config.json`.

5. Verify:
   - `ms.config.json` exists with `appId`, `environmentId`, and `repoType: "none"`
   - The Vite template was scaffolded (`package.json`, `src/`, `vite.config.ts`)

6. Install dependencies and test the local build:

   ```powershell
   npm install
   npm run build
   ```

7. Commit and push to GitHub.

   **If the repo is new/empty**, initialize it here and push:

   ```powershell
   git init
   git add .
   git commit -m "scaffold managed app"
   git branch -M main
   git remote add origin <your github repo URL>
   git push -u origin main
   ```

   **If the app lives inside an existing repo** (already cloned, has its own history/branch), do **not** run `git init` in the app folder — that creates a nested repo with unrelated history and the push will be rejected (`non-fast-forward` / `refusing to merge unrelated histories`). Instead, scaffold the app *inside* your existing clone and commit it as a subdirectory:

   ```powershell
   cd <path to the existing clone>
   git checkout <branch>; git pull origin <branch>
   git add <app-dir>
   git commit -m "Add managed app scaffold"
   git push origin <branch>
   ```

---

## Step 4b — Grant the Service Principal edit access to the app (required for BYOB deploy)

**Needs:** you're signed in as the app **creator/owner** (interactive user auth, not the SPN), and `ms.config.json` is present in the app directory.

For BYOB apps (`repoType: none`), `EnvironmentAdmin` lets the SPN reach the environment but **not deploy this specific app** — deploy permission is granted at the *app scope*. Skip this and the CI deploy fails with:

> `You don't have permission to deploy this app. Ask an admin to grant you Contributor on the repo.`

As the app creator, grant the SPN **edit** access. Run it from the app directory so `--app` defaults from `ms.config.json`:

```powershell
# be yourself (the creator), not the SPN
Remove-Item Env:MS_CLI_USE_SP_AUTH,Env:MS_CLI_SP_CLIENT_ID,Env:MS_CLI_SP_CLIENT_SECRET,Env:MS_CLI_SP_TENANT_ID -ErrorAction SilentlyContinue
$env:MS_CLI_CLOUD_INSTANCE = 'test'   # or 'prod'

ms app share <SPN Application (client) ID> --access edit
```

If the client ID doesn't resolve, use the SPN's **Object ID** from Enterprise applications. For `repoType: none` apps the CLI grants contributor access at the app scope and prints: `App ... has no platform-managed repository, so granting contributor access at the app scope instead of repository scope.`

**Verification:** trigger the deploy (Step 7) — it should now pack, upload, and return a Play URL instead of the permission error.

---

## Step 5 — Configure GitHub repo secrets

**Needs:** a GitHub repo for the app with **Admin** or **Maintain** access (required to add Actions secrets). If the user only has Write, ask the repo admin to grant it or add them to a team with Admin.

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

**Needs:** `AllowExternalArtifactDeployment` enabled on the target environment — done back in **Step 2c**. If you skipped it, deploy fails here with `External artifact deployment is not enabled for this environment.`; have an admin enable it and re-run.

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
| `GitOperationsNotSupportedForNonExternalBuildRepo — only supported for repositories with RepoType=ExternallyProvidedBuild` (HTTP 400 on `uploadBuild`) | The app was registered server-side as `native`/`github` (created via `ms app init`), but `ms.config.json` says `repoType: none`. Hand-editing `repoType` does **not** change the server record | Recreate the app with `ms app create --repo none` in an empty dir (registers it as external-build server-side), then point your project at the new `appId`. See **Step 4** |
| `EnvironmentNotFound ... 'Default-<guid>' could not be found` on `ms app create`/`init` | `MS_CLI_MAAF_DEBUG_ENVIRONMENT_ID` was set to the `Default-<guid>` environment *name* instead of the environmentId GUID | Set `MS_CLI_MAAF_DEBUG_ENVIRONMENT_ID` to the environmentId **GUID** — see **Step 4.3** |
| `External artifact deployment is not enabled for this environment` | Environment setting `MicrosoftApps_AllowExternalArtifactDeployment` isn't `true` | Enable it via the Environment Management API — see **Step 2c** (`assets/set-allowexternalartifactdeployment.ps1`); do it before the first deploy |
| `You don't have permission to deploy this app. Ask an admin to grant you Contributor on the repo.` | BYOB app: SPN has `EnvironmentAdmin` but lacks edit/Contributor at the **app scope** | The app creator runs `ms app share <spn> --access edit` — see **Step 4b** |
| `AADSTS7000215: Invalid client secret provided` (Step 3 smoke test or deploy) | Used the client secret **ID** instead of its **Value** | Copy the **Value** column in **Certificates & secrets** (shown only at creation — create a new secret if lost); re-set `MS_CLI_SP_CLIENT_SECRET` locally and the `PP_SP_CLIENT_SECRET` repo secret |
| `ms.config.json not found in working-directory` | Action's `working-directory` input doesn't point at the app | Set `working-directory` to the path containing `ms.config.json` |
| Workflow runs green but the app doesn't update in the player | Browser cached an older bundle | Hard-refresh; verify the workflow's `commit-sha` output matches the latest commit |

---

## What to do for each new environment

The SPN is a per-tenant resource; **the permission grant is per-environment**. If the same SPN deploys to multiple envs:

- For each DV env → re-do Step 2a
- For each non-DV env → re-do Step 2b
- The workflow can target different envs by changing the `cloud` input (or by using separate apps with different `ms.config.json` files)

## Notable detail — `ms app share` for principal access

Beyond the SPN grant in **Step 4b**, the same command shares an app with a colleague or another principal:

```powershell
ms app share <principal-objectId-or-upn> --access edit
```

For BYOB apps (`repoType: 'none'`), this grants contributor access **at the app scope** (since there's no platform-managed repository). The CLI surfaces this automatically: `App ... has no platform-managed repository, so granting contributor access at the app scope instead of repository scope.`

## What this guide does NOT cover

- Federated identity (OIDC) auth — not yet supported by `@microsoft/managed-apps-cli`.
- Multi-stage promotion (dev → test → prod). Build the basic flow first.
- GRS-managed (`--repo native`) or GHE-bound (`--repo <ghe-url>`) flows — different code paths and CI patterns.
