# Quick Start Guide

Build and run a Microsoft App using just your coding copilot. No prior Microsoft Apps knowledge needed.

---

## Step 1 — Install Prerequisites

You need two tools installed before starting:

**Node.js v22 or higher**
Download from [nodejs.org](https://nodejs.org). After installing, verify:
```
node --version   # should print v22.x.x or higher
```

**Git**
Microsoft Apps stores app code in a remote git repository, and `ms app create` initializes the local repo. Install from [git-scm.com](https://git-scm.com). Git for Windows includes Git Credential Manager, which the first `ms app create` will exercise.

That's it for now — `/create-app` installs the `ms` CLI itself globally on its first run.

---

## Step 2 — Install the Plugin

This plugin works with GitHub Copilot CLI and Claude Code. Commands are the same for both. You only need to install once; the plugin is then available in every project folder.

Run `copilot` or `claude` in any folder, then:

```
/plugin marketplace add microsoft/Managed-Apps
/plugin install microsoft-managed-apps@Managed-Apps
```

---

## Step 3 — Create Your First App

Navigate to an **empty** folder where you want your project. `/create-app` treats your current folder as the project root:

```
/create-app
```

Your copilot will:

1. Install `@microsoft/managed-apps-cli@latest` globally (with your confirmation) from the public npm registry.
2. Ask you what you want to build, plain English.
3. Run `ms app create` to scaffold the project.
4. Start `ms app dev` so you can play the app locally in the App Player.

If the folder is not empty, the skill will stop and ask you to switch to an empty folder (or explicitly confirm overwrite behavior).

Nothing deploys to the cloud at this point — local dev only.

---

## Dive Deeper

### Iterate Locally

Once an app exists, restart the local dev server anytime:

```
/dev
```

### Connect Data Sources

Your copilot will recommend data sources based on what your app needs to do. To be explicit, run any of these from inside the project folder:

| What you want to do                  | Command            |
| ------------------------------------ | ------------------ |
| Store custom business data           | `/add-dataverse`   |
| Read/write SharePoint lists          | `/add-sharepoint`  |
| Read/write an Excel workbook         | `/add-excel`       |
| Upload or download files             | `/add-onedrive`    |
| Send emails or manage calendar       | `/add-office365`   |
| Send Teams messages                  | `/add-teams`       |
| Query Azure DevOps work items        | `/add-azuredevops` |
| Invoke a Copilot Studio agent        | `/add-mcscopilot`  |
| Search M365 knowledge with Work IQ   | `/add-workiq`      |
| Something else (any other connector) | `/add-data-source` |

Each command runs `ms app add data-source --connector <api-id>` against the right connector, regenerates typed TypeScript services under `src/`, and verifies the build. Your local `ms app dev` hot-reloads the new services.

### Ship to the Cloud

```
/deploy
```

Two paths. Your copilot will ask which you want:

- **Local-built**: `npm run build`, then `git add -A && git commit && git push`, then `ms app deploy`.
- **Cloud-built**: `git add -A && git commit && git push`, then `ms app deploy --commit <sha>`.

Always confirms before deploying, and always syncs changes to git before deploy.

### Resuming a Session

After the first `ms app create`, the project folder gets a `memory-bank.md`. Open a new copilot session in the same folder and your copilot reads it to pick up where you left off (including which environment + cluster).

### Troubleshooting

| Problem                                                       | Fix                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ms` command not found after install        | Verify `npm config get prefix` directory's `bin` is on PATH. On Windows that's `%APPDATA%\npm`.                           |
| First `ms app create` fails with `Authentication failed for '...d.environment.api...'` | Git Credential Manager hasn't done the interactive flow yet. Your copilot will walk you through the recovery automatically. |
| Build errors                                                  | Run `npm install` in the project folder, then retry.                                                                       |
| Node.js version error                                         | Run `node --version` — must be v22+. Upgrade if needed.                                                                    |

### Telemetry

The plugin tags the `ms` CLI commands it runs (via an `MS_CLI_ORIGIN` attribution prefix) so usage can be attributed to this plugin. It adds no new data collection and you can opt out by setting `MS_CLI_ORIGIN` yourself. See the [Telemetry section in the README](./README.md#telemetry) for details.

### Uninstall

```
/plugin uninstall microsoft-managed-apps
```
