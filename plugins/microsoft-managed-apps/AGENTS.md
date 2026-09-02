# Microsoft Managed Apps Plugin — Development Guidelines

This file provides instructions for assistants working on the Microsoft Apps plugin itself (not for end-users of the plugin).

## Overview

The Microsoft Apps plugin wraps `@microsoft/managed-apps-cli` (binary `ms`) to scaffold, develop, and ship Microsoft Apps end-to-end. It provides skills for:

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
| `shared/development-standards.md`   | Versioning, theme, CLI install pattern, build rules, TypeScript strict mode.                    |
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
| `/add-dataverse`   | Dataverse tables (typed services).                                        |
| `/add-sharepoint`  | SharePoint Online lists/documents.                                        |
| `/add-excel`       | Excel Online (Business) workbooks.                                        |
| `/add-office365`   | Office 365 Outlook (calendar, email).                                     |
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
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion, ...
model: sonnet  # or opus for design-heavy work
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.
```

## Agent

| Agent                       | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `microsoft-apps-architect`  | Architecture advisor for connector selection, codegen patterns, deploy. |

## Testing changes

After modifying this plugin:

1. Bump the `version` field in `.claude-plugin/plugin.json` and the matching plugin entry in the repo-root `.claude-plugin/marketplace.json`.
2. Test in a fresh project: `/create-app` end-to-end, then a representative `/add-*`.
3. Verify any new `allowed-tools` entries are minimal — request only what the skill needs.
