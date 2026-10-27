---
name: add-azuredevops
description: Adds Azure DevOps by delegating to `/add-data-source` with `api-id=shared_visualstudioteamservices` and action mode. Use when adding Azure DevOps integration.
allowed-tools: Read AskUserQuestion Skill
---

**📋 Shared Instructions: [shared-instructions.md](../../shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Azure DevOps (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_visualstudioteamservices`
- `mode`: `action`
