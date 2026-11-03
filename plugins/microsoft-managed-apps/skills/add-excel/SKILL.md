---
name: add-excel
description: Adds Excel Online (Business) by delegating to `/add-data-source` with `api-id=shared_excelonlinebusiness` and table mode. Use when binding Excel tables.
allowed-tools: Read AskUserQuestion Skill
---

**📋 Shared Instructions: [shared-instructions.md](../../shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Excel Online (Business) (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_excelonlinebusiness`
- `mode`: `table`
- required args: `dataset`, `table`

Collect missing `dataset`/`table` values first, then delegate.
