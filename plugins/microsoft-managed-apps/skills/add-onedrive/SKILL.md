---
name: add-onedrive
description: Adds OneDrive for Business by delegating to `/add-data-source` with `api-id=shared_onedriveforbusiness` and action mode. Use when integrating OneDrive files.
user-invocable: true
allowed-tools: Read, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Add OneDrive for Business (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_onedriveforbusiness`
- `mode`: `action`
