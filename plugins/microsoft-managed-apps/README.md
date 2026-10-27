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
2. Open the Plugins Directory in the ChatGPT desktop app with Codex plugin support.
3. Select `Managed-Apps` and install `microsoft-managed-apps`, following the current Codex packaging guide.
4. Start a new session before checking the installed skills.

**Compatibility status:** the portable package does not establish full Codex runtime support.
Skills use document-relative links to shared resources. They do not require `${CLAUDE_PLUGIN_ROOT}`.
The package does not provide a Codex architect agent or Codex hooks.
Shared instructions request `plugin/codex` attribution while preserving an existing `MS_CLI_ORIGIN` value.
This attribution depends on the agent following instructions, not hook enforcement.
Complete the client checks below before using workflows that change resources.

### Compatibility layout and model selection

| Path within the plugin | Consumer and purpose |
| --- | --- |
| `plugin.json` | Canonical Agent Plugins 1.0.0 metadata. |
| `.claude-plugin/plugin.json` | Claude Code and legacy clients. Regular JSON mirror, excluding only `$schema`. |
| `skills/` | One portable skill set for all clients. |
| `agents/microsoft-apps-architect.md` | Claude Code and legacy Copilot architect. |
| `com.github.copilot/agents/microsoft-apps-architect.agent.md` | Architect copy for Copilot's Agent Plugins discovery. Only relative resource paths differ. |
| `hooks/hooks.json` | Claude Code and legacy Copilot hook configuration. |
| `com.github.copilot/hooks/hooks.json` | Native Copilot hook configuration using `${PLUGIN_ROOT}`. |
| `hooks/*.sh` and `hooks/*.ps1` | Shared executable hooks. Both configurations run these same scripts. |

Keep the Claude manifest. Claude still reads it even when a newer Copilot selects the root manifest.
Neither marketplace nor plugin identity changes. All compatibility copies are regular files, not symlinks.

**Intentional behavior change for review:** skills now inherit the model selected in the client.
Version 2.1.4 requested Sonnet or Opus through Claude-specific `model` fields.
The portable skill set removes those overrides instead of duplicating skill definitions.
This can change response quality, speed, and cost for Claude users.
The team must review this exception to issue #34's unchanged-behavior requirement.
The removed `user-invocable: true` field matches Claude's default, so skills remain user-invocable.
The workflow instructions and tool permissions remain, with portable resource links.

### Package maintenance and validation

The legacy `.claude-plugin/plugin.json` is a regular JSON mirror of the canonical manifest, excluding only `$schema`.
This preserves the legacy format while the canonical manifest declares the Agent Plugins version.
Do not replace either file with a symlink.
The existing `.claude-plugin/marketplace.json` installation path, marketplace identity, and plugin identity remain unchanged.

From the repository root, run:

```sh
node scripts/validate-plugin-compatibility.mjs
node --test scripts/validate-plugin-compatibility.test.mjs
python -m pip install -r scripts/requirements-plugin-validation.txt
python scripts/validate_plugin_skills.py
python -m unittest discover -s scripts -p "*_test.py"
node --test scripts/plugin-hooks.test.mjs
```

Run the Python commands in a virtual environment with Python 3.11 or later.
Python is a development dependency, not a new requirement for plugin installation.
The existing Bash hooks still require a working Python interpreter.

The generic `PR pipeline` workflow in `.github/workflows/pr.yml` runs plugin compatibility as its first and only job.
This job runs these checks on Windows and Ubuntu. Add future PR checks as separate jobs in the same workflow.
To block merges, require both platform-specific `Plugin compatibility` checks in the repository ruleset.
Validation checks manifests, regular files, metadata equivalence, marketplace identity, architect copies, hook configurations, and local resource links.
The pinned Agent Skills reference library checks every immediate skill directory.
Regression tests reject invalid skill metadata, missing components, and compatibility drift.
Hook tests check both payload formats, command attribution, user overrides, and paths containing spaces.
Windows tests execute PowerShell scripts. Ubuntu tests execute Bash scripts.
Only the canonical `$schema` field is excluded from the manifest comparison.
Object key order and whitespace do not affect the comparison.
Update both manifests and the legacy marketplace version together for each release.

### Client test matrix

Package checks cannot prove client runtime compatibility.
Record the exact client version, OS, source revision, commands, observed components, and results for each row.
Run install and upgrade checks in disposable client profiles, never an existing customer profile.
Do not mark an unexecuted check as passed.

| Client and scenario | Required result | Current evidence |
| --- | --- | --- |
| Claude Code, fresh install | 21 skills, architect, both hooks, resource links, daily version check, selected model, `/create-app`, and one `/add-*`. | Pending. Claude is not installed on the implementation machine. |
| Claude Code, upgrade from 2.1.4 | Same components after update, without reinstalling. Existing marketplace and plugin identities remain. | Pending. |
| Copilot CLI, fresh install on Windows | 21 skills, architect from `com.github.copilot`, both hooks, resource links, daily version check, and user attribution overrides. | Local marketplace installation and discovery passed for all 21 skills. Runtime agent and hook loading remain pending. |
| Copilot CLI, upgrade from 2.1.4 on Windows | Same components and identity after update, without reinstalling. | Local marketplace changed from 2.1.4 to 2.1.5 with the same 21 skill names and one `Managed-Apps` registration. Git-backed update and runtime checks remain pending. |
| Codex, fresh install | 21 skills, resolved shared resources, representative CLI attribution, and documented absence of bundled agents/hooks. | Pending. Codex is not installed on the implementation machine. |
| Windows and Linux client flows | Fresh and upgrade results agree across platforms. | Windows local discovery evidence only. Both CI platforms are configured. Linux client flows remain pending. |
| Activation and updates | Disable and enable without reinstalling. No duplicate identity. Malformed or drifted compatibility files fail CI. | Negative package checks pass locally. Activation remains pending because the installed CLI rejects the documented enable/disable subcommands. |

The Windows checks ran on 2026-10-26.
`copilot --version` reported `1.0.102-0.unstable.r40029025960.g5a14a15`.
The local CLI dispatcher supports installation and skill listing but rejects `plugin list --json` and `plugin enable`/`disable`.
These limits prevent a full runtime-support claim.

#### Commands and evidence

For a fresh Copilot check, set `COPILOT_HOME` to an empty disposable directory.
Set `COPILOT_AUTO_UPDATE=false` to prevent unrelated marketplace updates.
Run these commands from a disposable project:

```text
copilot --version
copilot plugin marketplace add <repository-root>
copilot plugin install microsoft-managed-apps@Managed-Apps
copilot plugin list
copilot plugin marketplace list
copilot skill list --json
```

Captured local results: installation reported `Installed 21 skills`.
The plugin list contained one enabled `microsoft-managed-apps@Managed-Apps (v2.1.5)` entry.
The skill list contained all 21 packaged skill names.

For the local upgrade check, export baseline commit `a069a3a2b8702db7f2cff2499b3162d2fee3d539` with `git archive`.
Include `plugins/microsoft-managed-apps` and `.claude-plugin/marketplace.json`.
Extract the archive into a disposable marketplace directory.
Register and install that directory with the fresh-install commands above.
Capture the 2.1.4 plugin and skill lists.
Replace its plugin files and marketplace manifest with the candidate files, without changing its registered path.
Then run:

```text
copilot plugin marketplace update Managed-Apps
copilot plugin update microsoft-managed-apps@Managed-Apps
copilot plugin list
copilot plugin marketplace list
copilot skill list --json
```

Captured local results: version changed from 2.1.4 to 2.1.5, all 21 skill names matched, and one marketplace registration remained.
The CLI reported that the local plugin loads live and needs no copy or reinstall.
This does not prove a Git-backed cache update.

For Git-backed Claude and Copilot upgrades, install baseline 2.1.4 through a disposable marketplace pointing at that revision.
Advance that same source to the candidate revision.
In each client's interactive session, run `/plugin marketplace update Managed-Apps` and `/plugin update microsoft-managed-apps@Managed-Apps`.
Do not uninstall, reinstall, or add another marketplace.
Record `/plugin`, `/skills`, and `/agent` results using the commands supported by that client version.
Run the client's enable/disable actions and confirm that the same components return.

For each supported Claude and Copilot runtime, run `ms --version` through a shell tool.
Capture the rewritten command or CLI attribution evidence.
Repeat with `MS_CLI_ORIGIN=review/custom` already set and confirm that the hook preserves it.
Check session-start guidance and the daily version-check instructions.
Run `/create-app` and a representative `/add-*` only in an authorized test environment.
For Codex, verify the documented instruction-based attribution instead of expecting a hook.
Attach client versions, commands, and sanitized results to the PR before claiming full runtime compatibility.

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

For Agent Plugins Copilot, the hook configuration is `com.github.copilot/hooks/hooks.json`.
Disable hooks in the client's settings rather than editing only the legacy configuration.

## Uninstall

```
/plugin uninstall microsoft-managed-apps
```

## Documentation

- [`@microsoft/managed-apps-cli` on npm](https://www.npmjs.com/package/@microsoft/managed-apps-cli)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins-reference)