---
name: add-teams
description: Adds Microsoft Teams by delegating to `/add-data-source` with `api-id=shared_teams` and action mode. Use when integrating Teams messaging.
user-invocable: true
allowed-tools: Read, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Teams (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_teams`
- `mode`: `action`
