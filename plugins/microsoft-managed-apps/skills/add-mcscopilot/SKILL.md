---
name: add-mcscopilot
description: Adds Microsoft Copilot Studio by delegating to `/add-data-source` with `api-id=microsoftcopilotstudio` and action mode. Use when integrating Copilot Studio agents.
allowed-tools: Read AskUserQuestion Skill
---

**📋 Shared Instructions: [shared-instructions.md](../../shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Microsoft Copilot Studio (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `microsoftcopilotstudio`
- `mode`: `action`
