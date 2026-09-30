---
name: add-sharepoint
description: Adds SharePoint Online by delegating to `/add-data-source` with `api-id=shared_sharepointonline` and table mode. Use when binding SharePoint lists/libraries.
user-invocable: true
allowed-tools: Read, AskUserQuestion, Skill
model: opus
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Add SharePoint Online (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_sharepointonline`
- `mode`: `table`
- required args: `dataset` (site URL), `table` (list/library name)

Collect missing `dataset`/`table` values first, then delegate.
