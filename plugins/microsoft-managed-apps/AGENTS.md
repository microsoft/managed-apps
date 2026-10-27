# Microsoft Managed Apps Plugin — Development Guidelines

This file provides instructions for assistants working on the managed apps plugin itself (not for end-users of the plugin).

## Overview

The managed apps plugin wraps `@microsoft/managed-apps-cli` (binary `ms`) to scaffold, develop, and ship managed apps end-to-end. It provides skills for:

- Creating a new app (`/create-app`) — global install of the CLI, scaffold, local dev loop.
- Iterating locally (`/dev`) — `ms app dev`, hot reload against the App Player.
- Lifecycle ops (`/deploy`, `/share`, `/delete-app`, `/list-apps`).
- Binding data sources (`/add-dataverse`, `/add-sharepoint`, etc.) — generates typed TypeScript services under `src/`.

## Memory Bank System

This plugin uses a memory bank (`memory-bank.md`) to persist state across sessions.

- **Location**: `<PROJECT_ROOT>/memory-bank.md` (in the user's project, not the plugin).
- **Instructions**: See `shared/memory-bank.md` for the full schema.
- Skills read the memory bank at start and update it after major steps. The schema records the environment id the CLI resolved for **reference only** (e.g. reconstructing the App Player URL); it is not used to re-target `ms app create`, which resolves an environment automatically each run.

## Shared Resources

| File                                | Purpose                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `shared/shared-instructions.md`     | Meta file aggregating all cross-cutting concerns — every skill links to it.                     |
| `shared/planning-policy.md`         | When to enter plan mode and what to include in the plan.                                        |
| `shared/memory-bank.md`             | Memory bank schema + read/update protocol.                                                      |
| `shared/development-standards.md`   | Theme, CLI install pattern, build rules, TypeScript strict mode.                                |
| `shared/allowed-actions.md`         | `allowedActions` authoring for shared connection references — required before pack/deploy.      |
| `shared/version-check.md`           | Daily plugin-version check against the marketplace.                                             |

### Adding new shared instructions

1. Create the file in `shared/` (e.g., `new-policy.md`).
2. Add a section to `shared/shared-instructions.md` referencing it.
3. No changes needed to individual SKILL.md files — they already link to `shared-instructions.md`.

## Skills

### Stage 1: scaffold

| Skill         | What it does                                                  |
| ------------- | ------------------------------------------------------------- |
| `/create-app` | Installs the CLI globally, scaffolds, ends on `ms app dev`.   |

### Stage 2: lifecycle

| Skill          | Wraps                                            |
| -------------- | ------------------------------------------------ |
| `/dev`         | `ms app dev` (local App Player, hot reload).     |
| `/deploy`      | `ms app deploy` (default) plus optional `ms app build` / `ms app build-status` traceability flow. |
| `/play`        | `ms app play` — open live or preview URL in browser. |
| `/share`       | `ms app share` / `unshare`.                      |
| `/share-link`  | `ms app share link create` / `list` / `revoke`.  |
| `/delete-app`  | `ms app delete` (idempotent).                    |
| `/list-apps`   | `ms app list` / `ms app show`.                   |

### Stage 3: data sources

| Skill              | What it adds                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `/state`           | Built-in app state schema via `ms project state` and generated TypeScript services. |
| `/add-dataverse`   | Dataverse tables (typed services).                                        |
| `/add-sharepoint`  | SharePoint Online lists/documents.                                        |
| `/add-excel`       | Excel Online (Business) workbooks.                                        |
| `/add-office365`   | Office 365 Outlook (calendar, email).                                     |
| `/add-office365-users` | Office 365 Users (profiles, org relationships, profile photos).       |
| `/add-teams`       | Teams messaging.                                                          |
| `/add-onedrive`    | OneDrive for Business files.                                              |
| `/add-azuredevops` | Azure DevOps work items / pipelines.                                      |
| `/add-mcscopilot`  | Microsoft Copilot Studio agents.                                          |
| `/add-workiq`      | Work IQ Copilot MCP for Microsoft 365 knowledge-grounded search/chat.     |
| `/add-data-source` | Generic fallback for any other connector.                                 |
| `/list-connectors` | Enumerate connectors / bound data sources for discovery.                  |

### Workflow

```
/create-app
   └── /dev (default loop)
   └── /add-data-source (or specific /add-*)
   └── /deploy (explicit, requires confirmation)
   └── /share, /delete-app (explicit, require confirmation)
```

### Skill structure

```
skills/<skill-name>/
├── SKILL.md                  # Workflow
└── references/               # Optional deep-dive docs
    └── <topic>-reference.md
```

### Skill header

```markdown
---
name: kebab-case-name
description: Short, action-oriented sentence the model uses for retrieval. Mention `ms` CLI verbs explicitly.
allowed-tools: Read Edit Write Grep Glob Bash AskUserQuestion
---

**📋 Shared Instructions: [shared-instructions.md](../../shared/shared-instructions.md)** — Cross-cutting concerns.
```

Use only [Agent Skills frontmatter fields](https://agentskills.io/specification).
Keep one skill set for all clients. Do not add `model` or `user-invocable`.
Skills inherit the client's selected model. Claude's default keeps skills user-invocable.
Resolve resource links relative to the containing Markdown file, not the user's project.

## Agent

| Agent                       | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `microsoft-apps-architect`  | Architecture advisor for connector selection, codegen patterns, deploy. |

## Testing changes

After modifying this plugin:

1. Update the canonical `plugin.json` at this plugin's root, including its version.
2. Copy its metadata to `.claude-plugin/plugin.json`, excluding only `$schema`. Keep both files as regular JSON files, never symlinks.
3. Update the matching version and description in the repo-root `.claude-plugin/marketplace.json`. Preserve its marketplace name, plugin name, and source path.
4. Keep the repo-root `.agents/plugins/marketplace.json` entry pointed at this same plugin directory.
5. Run `node scripts/validate-plugin-compatibility.mjs` from the repository root.
6. Run `node --test scripts/validate-plugin-compatibility.test.mjs` from the repository root.
7. Install validation dependencies with `python -m pip install -r scripts/requirements-plugin-validation.txt` in a virtual environment.
8. Run `python scripts/validate_plugin_skills.py`.
9. Run `python -m unittest discover -s scripts -p "*_test.py"`.
10. Run `node --test scripts/plugin-hooks.test.mjs`.
11. Follow the client test matrix in [README.md](README.md) before claiming runtime compatibility.
12. Verify any new `allowed-tools` entries are minimal — request only what the skill needs.

Keep `agents/microsoft-apps-architect.md` as the source for the architect.
Copy it to `com.github.copilot/agents/microsoft-apps-architect.agent.md` after each edit.
Change its `../shared/` links to `../../shared/` in the copy.
The validator rejects any other difference.

Keep executable hooks in `hooks/`. Do not copy their scripts.
Claude and legacy Copilot discover `hooks/hooks.json`.
Agent Plugins Copilot discovers `com.github.copilot/hooks/hooks.json`.
The latter uses native Copilot events, `${PLUGIN_ROOT}`, and the same scripts.
Validation checks both configurations for equivalent scripts, matchers, and timeouts.
Keep both hook payload contracts when editing a script.

The canonical manifest follows [Agent Plugins 1.0.0](https://agent-plugins.org/specification).
That version requires root `plugin.json`, not the older `.plugin/plugin.json` layout.
The generic `PR pipeline` workflow in `.github/workflows/pr.yml` contains one job: plugin compatibility.
This job checks manifests, component compatibility, resource links, skill validity, and hooks on Windows and Ubuntu.
The Python dependency is the Agent Skills reference validator, pinned to a Git commit.
Add future PR checks as separate jobs in this workflow.
Client installation, updates, shared-resource resolution, and hook behavior still need host-level checks before claiming support for a new client.
