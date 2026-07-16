# Managed Apps GitHub Actions — Architecture & Flow

How the actions under `github-actions/` fit into the end-to-end managed apps lifecycle:
one-time app setup, the local dev loop, the CI/CD deploy loop, and how this repo
releases the actions themselves. Diagrams are Mermaid (render on GitHub).

## Components

| Piece | Role |
|---|---|
| `ms` CLI (`@microsoft/managed-apps-cli`) | Does the real work: scaffolds, builds, packs, uploads, deploys, shares. |
| `install-ms-cli` action | Installs the `ms` CLI on the runner. |
| `ms-app-pack` action | Wraps `ms app pack` (build + stage artifact). Optional — deploy can pack internally. |
| `ms-app-deploy` action | Wraps `ms app deploy` (build + pack + upload + deploy). |
| `ms.config.json` | Per-app config (`appId`, `environmentId`, `repoType`) written by `ms app create`. |
| Target environment | Deploy target; needs `AllowExternalArtifactDeployment` enabled for BYOB (`repoType: none`) deploys. |
| Release workflow + [release guide](release-guide.md) | Versions and publishes the actions (this repo). |

## 1. End-to-end activity flow

Three phases: one-time setup (local), then either the local dev loop or the CI
loop reuse the same `ms.config.json` + environment.

```mermaid
flowchart TD
    subgraph Setup["One-time setup (local)"]
        A1["ms app create --repo none"] --> A2["ms.config.json written<br/>(appId, environmentId, repoType: none)"]
        A3["Admin enables<br/>AllowExternalArtifactDeployment<br/>on the environment"]
    end

    subgraph Local["Local dev loop"]
        B1["edit app code"] --> B2["npm install"]
        B2 --> B3["ms app deploy"]
        B3 --> B4{"AllowExternalArtifactDeployment<br/>enabled?"}
        B4 -- "No" --> B5["Error: external artifact<br/>deployment not enabled"]
        B4 -- "Yes" --> B6["build + pack + upload<br/>returns appId, commit, Play URL"]
        B6 --> B7["ms app share --access edit<br/>(app-scope for repoType: none)"]
    end

    subgraph CI["CI/CD loop (GitHub Actions)"]
        C1["actions/checkout@v5"] --> C2["actions/setup-node@v5<br/>(node 24)"]
        C2 --> C3["npm install (app dir)"]
        C3 --> C4["install-ms-cli"]
        C4 --> C5["ms-app-deploy"]
        C5 --> C6{"auth identity?"}
        C6 -- "service principal<br/>(all 3 inputs)" --> C7["deploys as the SPN<br/>(no developer in the loop)"]
        C6 -- "interactive" --> C8["not available on a runner"]
    end

    A2 --> B1
    A3 --> B4
    A2 --> C3
    A3 --> C5
```

## 2. Inside `ms-app-deploy`

What the deploy action does on each run, and where the service
can reject it.

```mermaid
sequenceDiagram
    participant WF as Workflow
    participant ACT as ms-app-deploy
    participant CLI as ms CLI
    participant RP as Managed Apps service

    WF->>ACT: with working-directory, app-id, client-secret, tenant-id
    ACT->>ACT: require MS_MANAGED_APPS_INSTALLED == true
    ACT->>ACT: read ms.config.json -> repoType
    ACT->>ACT: set MS_CLI_* SPN env (only if all 3 provided)
    ACT->>CLI: ms app deploy [--artifact | --commit | pack+upload]
    CLI->>CLI: npm run build, then pack client output
    CLI->>RP: upload artifact + deploy
    RP->>RP: check AllowExternalArtifactDeployment + identity
    alt artifact deployment disabled
        RP-->>CLI: external artifact deployment not enabled
    else ok
        RP-->>CLI: appId, commit, Play URL
    end
    CLI-->>ACT: JSON result
    ACT-->>WF: outputs app-id, environment-id, commit-sha
```

Deploy mode is chosen from `repoType` + inputs:

| `repoType` | input | CLI call |
|---|---|---|
| `none` | `artifact-path` | `ms app deploy --artifact <zip>` |
| `none` | (none) | `ms app deploy` (CLI packs + uploads) |
| `native` / `github` | `commit-sha` (or `GITHUB_SHA`) | `ms app deploy --commit <sha>` |

## 3. Release & versioning flow (this repo)

How a change to the actions becomes a `@v1` update consumers receive.

```mermaid
flowchart LR
    D1["change under github-actions/"] --> D2["prepare release PR<br/>(bump + changelog + dist)"]
    D2 --> D3["branch from origin/main<br/>bump package.json<br/>update CHANGELOG<br/>rebuild dist"]
    D3 --> D4["open PR to main"]
    D4 --> D5["review + merge"]
    D5 --> D6["release workflow (push to main)"]
    D6 --> D7{"dist fresh?"}
    D7 -- "no" --> D8["fail: rebuild + commit dist"]
    D7 -- "yes" --> D9{"tag vX.Y.Z exists?"}
    D9 -- "yes" --> D10["fail: bump version"]
    D9 -- "no" --> D11["tag vX.Y.Z + move vX alias"]
    D11 --> D12["consumers @v1 get the update"]
```

- `package.json` version is the single source of truth (`vMAJOR.MINOR.PATCH`).
- `v1` (moving) is what consumers pin; `vX.Y.Z` (immutable) is the rollback point.
- A major bump produces a fresh `vN` alias and leaves older majors untouched.

## Prerequisites & gotchas (from real testing)

- **`AllowExternalArtifactDeployment` must be enabled** on the target environment
  for `repoType: none` (BYOB) deploys. Observed: `ms app deploy` failed twice with
  *"External artifact deployment is not enabled for this environment"* until an
  admin enabled it, then succeeded and returned the appId / commit / Play URL.
- **`repoType: none` needs no git remote.** `ms app create --repo none` scaffolds
  from a template and writes `ms.config.json`; deploy builds locally and uploads
  the artifact. No `git init`/remote required.
- **Cloud target** is set via `MS_CLI_CLOUD_INSTANCE` (e.g. `test`). The
  `ms-app-deploy` action exposes this as the `cloud` input.
- **Auth:** interactive sign-in (`ms auth login`) works for local dev. For CI,
  supply all three Service Principal inputs (`app-id`, `client-secret`,
  `tenant-id`) — the actions set `MS_CLI_USE_SP_AUTH` + `MS_CLI_SP_*`, and the service
  accepts the SPN for managed apps operations, so the deploy runs with no developer in
  the loop.
- **Sharing:** for `repoType: none` apps (no platform-managed repo),
  `ms app share <id> --access edit` grants contributor access at the **app scope**
  rather than the repository scope.

### Example (non-Dataverse environment)

```pwsh
$Env:MS_CLI_CLOUD_INSTANCE = 'prod'   # the cloud your environment lives in
ms app create --display-name "My managed app" --repo "none"
npm install
ms app deploy            # succeeds once AllowExternalArtifactDeployment is on
ms auth login
ms app share <app-id> --access edit
```
