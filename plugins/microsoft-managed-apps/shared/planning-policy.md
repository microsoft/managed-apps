# Planning Policy

**Before implementing major changes, the assistant MUST enter plan mode first.**

## When Planning is Required

- Adding new features or components
- Modifying existing workflows or logic
- Changes affecting multiple files
- Adding or modifying data sources / connectors
- Changes to app configuration or environment settings
- UI restructuring or new page/component creation

## How to Plan

1. **Enter Plan Mode**: Use `EnterPlanMode` before writing any code.
2. **Explore**: Read relevant files and understand the current implementation.
3. **Design**: Create a clear implementation approach.
4. **Present**: Show the plan to the user for approval.
5. **Wait**: Do not proceed until the user approves.
6. **Exit**: Use `ExitPlanMode` when ready to implement.

## When Planning is NOT Required

- Single-line fixes (typos, minor corrections)
- Documentation-only updates
- Memory bank updates
- Adding comments or improving readability
- Running diagnostic commands (`ms app show --json`, `ms auth status`)
- Predefined connector skill workflows (`/add-teams`, `/add-excel`, `/add-sharepoint`, etc.) — these follow fixed linear steps that don't require architectural decisions

## Planning Checklist

Before exiting plan mode, ensure your plan covers:

- [ ] What files will be created or modified
- [ ] What the changes will do
- [ ] Any dependencies or prerequisites
- [ ] Potential risks or rollback steps
- [ ] Testing approach (`ms app dev` for local, build verification before any push)

## Plan Dump for Debugging

Write a file `<PROJECT_ROOT>/app_generated_plan.md` containing:

1. **User Request** — the original user prompt / app description that triggered planning.
2. **Generated Plan** — the full plan presented to the user for approval.

### When to write it

- **Existing project** (`PROJECT_ROOT` already exists): write it after the plan is finalized and before calling `ExitPlanMode`.
- **New app creation**: `PROJECT_ROOT` does not exist yet, write it immediately **after** the app is scaffolded and `PROJECT_ROOT` is set, before implementing the app. It is then tracked in the app's Git repository.

### Format

```markdown
# App Generated Plan

## User Request

<the original user prompt or app description>

## Generated Plan

<the full plan as presented to the user>

## Generated At

<ISO 8601 timestamp, e.g. 2026-05-12T14:30:00Z>
```

This file is purely for debugging — it is not used by any skill at runtime. Overwrite it on each new plan generation.
