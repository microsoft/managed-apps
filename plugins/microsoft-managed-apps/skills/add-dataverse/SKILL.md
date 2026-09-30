---
name: add-dataverse
description: Adds Dataverse by delegating to `/add-data-source` with `api-id=dataverse` and table mode. Use when binding Dataverse tables.
user-invocable: true
allowed-tools: Read, AskUserQuestion, Skill
model: opus
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Dataverse (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `dataverse`
- `mode`: `table`
- pass through known table names from user input

If table names are missing, ask for them, then delegate.
