# Microsoft Managed Apps Plugin `Preview`

> **Preview** — this plugin is in preview and under active development. Behavior may change.

Copilot plugin for building **Microsoft Apps** using `@microsoft/managed-apps-cli` (binary `ms`), React, and Vite. Works with both Claude Code and GitHub Copilot.

Microsoft Apps run locally against the App Player with hot reload (`ms app dev`) and deploy to the cloud only when you choose to.

## What's Included

| Command category | Includes |
| ---------------- | -------- |
| Scaffold         | `/create-app` |
| Lifecycle        | `/dev`, `/deploy`, `/play`, `/share`, `/share-link`, `/delete-app`, `/list-apps` |
| Data sources     | `/add-data-source`, `/add-dataverse`, `/add-sharepoint`, `/add-excel`, `/add-office365`, `/add-teams`, `/add-onedrive`, `/add-azuredevops`, `/add-mcscopilot`, `/add-workiq`, `/list-connectors` |

## Prerequisites

- [Node.js v22+](https://nodejs.org/)
- Git + Git Credential Manager
- [Claude Code](https://code.claude.com/docs/en/getting-started) or [GitHub Copilot CLI](https://github.com/features/copilot/cli/)
- Access to a Microsoft Apps-enabled tenant. The `@microsoft/managed-apps-cli` package is published on the public npm registry: [`@microsoft/managed-apps-cli`](https://www.npmjs.com/package/@microsoft/managed-apps-cli).

The `/create-app` skill handles the global install of `@microsoft/managed-apps-cli@latest` on its own — you don't need to set that up by hand.

## Install the plugin

1. Open your copilot in any project folder:
   ```
   claude
   ```
   or
   ```
   copilot
   ```

2. Add the marketplace:
   ```
   /plugin marketplace add microsoft/Managed-Apps
   ```

3. Install the plugin:
   ```
   /plugin install microsoft-managed-apps@Managed-Apps
   ```

## Try it

```
/create-app <description here>
```

Describe the app in the command and the skill generates its name, plans the complete requested experience for your approval, scaffolds it, builds it, and starts a local dev server in the App Player. Nothing deploys to the cloud unless you explicitly ask.

## Telemetry

This plugin sets an attribution tag on the `@microsoft/managed-apps-cli` (`ms`) commands it runs. A `PreToolUse` hook (`hooks/pre-tool-use.sh` / `.ps1`) transparently prefixes every shell command that invokes `ms` with `MS_CLI_ORIGIN=plugin/<host-agent>` (e.g. `plugin/claude-code`, `plugin/copilot-cli`). This tells the CLI's telemetry that the invocation originated from this plugin — it does **not** add any new data collection beyond what the `ms` CLI already reports, and it never blocks or alters the behavior of your command.

- **What it does:** tags `ms` CLI runs so usage can be attributed to this plugin.
- **What it does not do:** it does not run for non-`ms` commands, and it does not transmit anything itself.
- **Opting out:** set `MS_CLI_ORIGIN` yourself (in your shell environment or inline on the command) and the hook leaves your value untouched. You can also disable the hook by removing/editing `hooks/hooks.json`, or refer to the `ms` CLI documentation for its own telemetry controls.

## Uninstall

```
/plugin uninstall microsoft-managed-apps
```

## Documentation

- [`@microsoft/managed-apps-cli` on npm](https://www.npmjs.com/package/@microsoft/managed-apps-cli)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins-reference)