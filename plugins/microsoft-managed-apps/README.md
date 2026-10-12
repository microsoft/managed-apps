# Microsoft Managed Apps Plugin `Preview`

> **Preview** — this plugin is in preview and under active development. Behavior may change.

Copilot plugin for building **managed apps** using `@microsoft/managed-apps-cli` (binary `ms`), React, and Vite. Works with both Claude Code and GitHub Copilot.

Managed apps run locally against the App Player with hot reload (`ms app dev`) and deploy to the cloud only when you choose to.

## What's Included

| Command category | Includes |
| ---------------- | -------- |
| Scaffold         | `/create-app` |
| Lifecycle        | `/dev`, `/deploy`, `/play`, `/share`, `/share-link`, `/delete-app`, `/list-apps` |
| Data sources     | `/add-data-source`, `/add-dataverse`, `/add-sharepoint`, `/add-excel`, `/add-office365`, `/add-office365-users`, `/add-teams`, `/add-onedrive`, `/add-azuredevops`, `/add-mcscopilot`, `/add-workiq`, `/list-connectors` |

## Prerequisites

- [Node.js v22+](https://nodejs.org/)
- Git + Git Credential Manager
- [Claude Code](https://code.claude.com/docs/en/getting-started) or [GitHub Copilot CLI](https://github.com/features/copilot/cli/)
- Access to a managed apps-enabled tenant. The `@microsoft/managed-apps-cli` package is published on the public npm registry: [`@microsoft/managed-apps-cli`](https://www.npmjs.com/package/@microsoft/managed-apps-cli).

The `/create-app` skill handles the global install of `@microsoft/managed-apps-cli@latest` on its own — you don't need to set that up by hand.

## Install the plugin

### Claude Code and GitHub Copilot

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

### Agent Plugins and Codex discovery

The canonical manifest is `plugins/microsoft-managed-apps/plugin.json`, relative to the repository root.
It declares the [Agent Plugins 1.0.0 schema](https://agent-plugins.org/specification).
The published format uses root `plugin.json`, not `.plugin/plugin.json`.
Compatible clients discover the existing `skills/` directory from this plugin root.
This package does not bundle an MCP server, so it does not need `mcp.json`.

For Codex, the repository includes `.agents/plugins/marketplace.json`, following the
[Codex packaging guide](https://developers.openai.com/plugins/build/plugins).
Its entry points to the same plugin directory as the existing Claude marketplace.

To evaluate a local checkout containing these changes:

1. Add its repository root with `codex plugin marketplace add <checkout-path>`.
2. Open `/plugins` in a Codex CLI version with plugin support.
3. Select `Managed-Apps` and install `microsoft-managed-apps`.
4. Start a new session before checking the installed skills.

**Compatibility status:** the portable manifest and Codex catalog do not establish full Codex runtime support.
Skills and shared instructions still use `${CLAUDE_PLUGIN_ROOT}`.
Agents, hooks, and attribution remain host-specific and are not part of the portable Agent Plugins core.
Verify resource resolution and hook behavior in the target client before using workflows that change resources.
This packaging change leaves existing skill content and hook scripts unchanged.

### Manifest maintenance and validation

The legacy `.claude-plugin/plugin.json` is a regular JSON mirror of the canonical manifest, excluding only `$schema`.
This preserves the legacy format while the canonical manifest declares the Agent Plugins version.
Do not replace either file with a symlink.
The existing `.claude-plugin/marketplace.json` installation path, marketplace identity, and plugin identity remain unchanged.

From the repository root, run:

```sh
node scripts/validate-plugin-compatibility.mjs
node --test scripts/validate-plugin-compatibility.test.mjs
```

The PR workflow runs these checks on Windows and Linux.
To block merges on failures, configure both `Plugin compatibility` matrix checks as required in the repository ruleset.
Validation checks JSON objects, regular files, the Agent Plugins 1.0.0 manifest shape, metadata equivalence, and marketplace consistency.
Only the canonical `$schema` field is excluded from the manifest comparison.
Object key order and whitespace do not affect the comparison.
Update both manifests and the legacy marketplace version together for each release.

Before marking the interoperability PR ready, record the client versions and results for:

- Existing Claude Code and Copilot installations updating without reinstalling.
- Fresh installation through the legacy marketplace and the Codex catalog.
- Skill discovery, shared instructions, and the daily version check.
- Session-start hooks, `ms` command attribution, and preservation of an existing `MS_CLI_ORIGIN` value.
- `/create-app` and a representative `/add-*` workflow in an authorized test environment.

These host-level checks are separate from the automated manifest checks.

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