# Memory Bank Instructions

This document defines the memory bank system used to persist context across conversations and skill invocations. **All skills in this plugin follow these instructions.**

## Overview

The memory bank (`memory-bank.md`) is a markdown file stored in the project root that tracks:

- Project configuration and metadata
- Completed steps and progress
- User decisions and preferences
- Created resources (data sources, connectors, etc.)
- Current status and next steps

## File Location

The memory bank is always stored at: `<PROJECT_ROOT>/memory-bank.md`

---

## Before Starting Any Skill

**IMPORTANT**: Every skill MUST check for and read the memory bank before proceeding.

### Step 1: Locate the Memory Bank

1. If the user has specified a project path, check `<PROJECT_PATH>/memory-bank.md`.
2. If continuing from a previous skill in the same session, use the known project path.
3. If no path is known, ask the user for the project path.

### Step 2: Read and Parse Context

If the memory bank exists, extract:

| Information                       | Purpose                                                |
| --------------------------------- | ------------------------------------------------------ |
| Project path, name, version       | Know what you're working with                          |
| Completed steps (checkboxes)      | Skip steps already done                                |
| User preferences                  | Don't re-ask answered questions                        |
| Created resources                 | Know what data sources/connectors exist                |
| Current status                    | Understand where to resume                             |
| Environment id (resolved by CLI)  | Reference only (e.g. reconstruct the App Player URL) — not for re-targeting create |

### Step 3: Resume or Continue

- **If the current skill's steps are already marked complete**: Ask if they want to modify, add more, or skip to next steps.
- **If partially complete**: Inform the user and resume from the incomplete step.
- **If not started**: Begin from the first step.

### Step 4: Inform the User

Always tell the user what you found:

> "I found your project memory bank. [Summary: project name, version, what's been completed]. Let's continue from [next step]."

---

## After Each Major Step

Update the memory bank immediately after completing each major step. This ensures progress is saved even if the session ends unexpectedly.

### What to Update

1. **Mark completed steps** with `[x]`.
2. **Record created resources** (data sources, connectors, files).
3. **Save user decisions** (connector choice, table names, and any user-supplied environment ID).
4. **Update current status** and next step.
5. **Add timestamp** to "Last Updated".
6. **Add notes** for important context or decisions.

### Update Frequency

Update after:

- Completing any workflow step
- User makes a significant decision
- Creating or modifying resources
- Encountering errors or issues worth noting
- Before ending a session

---

## When to Create vs Update

| Scenario                    | Action                                                                            |
| --------------------------- | --------------------------------------------------------------------------------- |
| Memory bank doesn't exist   | Create it after the first major step (e.g., after `ms app create` succeeds).      |
| Memory bank exists          | Update it — preserve existing content, add new information.                       |
| Continuing previous session | Read first, then update as you progress.                                          |

## Template Structure

```markdown
# Microsoft App Memory Bank

> Last Updated: [TIMESTAMP]
> Session: [SESSION_ID or conversation context]

## Project Overview

| Property                              | Value                                                  |
| ------------------------------------- | ------------------------------------------------------ |
| App Name                              | [APP_NAME]                                             |
| App ID (slug)                         | [APP_ID]                                               |
| App GUID                              | [APP_GUID from ms.config.json]                      |
| Project Path                          | [FULL_PATH]                                            |
| Environment Name                      | [ENVIRONMENT_NAME]                                     |
| Environment ID                        | [ENVIRONMENT_GUID — reference only, resolved by CLI]   |
| Remote git URL                        | [URL]                                                  |
| Version                               | v1.0.0                                                 |
| Created Date                          | [DATE]                                                 |
| Status                                | [In Progress / Created / Local Dev Running / Deployed] |

## User Preferences

### Design Preferences
- Theme: [Dark/Light]
- Version Display: [Enabled/Disabled]

### Technical Preferences
- Data Sources: [Dataverse, Azure DevOps, Teams, Excel, etc.]

## Completed Steps

### /create-app
- [x] Prerequisites validated (Node.js, git, ms CLI)
- [x] Global install completed
- [x] `ms auth status` confirmed active account
- [x] `ms app create` succeeded
- [x] `git fetch origin` cleared the first-run Git Credential Manager trap (if it fired)
- [x] `npm install && npm run build` succeeded
- [x] `ms app dev` running locally
- App Player URL: [URL]

## Created Resources

### Data Sources

| Source       | Type      | Details                      |
| ------------ | --------- | ---------------------------- |
| [TABLE_NAME] | Dataverse | Columns: name, status, ...   |

### Generated Files

| File                                  | Source          |
| ------------------------------------- | --------------- |
| `generated/models/<Generator><Table>Model.ts`     | Dataverse table |
| `generated/services/<Generator><Table>Service.ts`   | Dataverse table |

## Current Status

**Last Action**: [Description of last completed action]

**Next Step**: [What the user should do next]

**Pending Items**:
- [ ] [Item 1]
- [ ] [Item 2]

## Notes & Issues

### Session Notes
- [Date]: [Note about decisions, issues, or context]

### Known Issues
- [Issue description and any workarounds]

## Quick Resume

To continue working on this project:

1. **Restart local dev**: `ms app dev` (from project root)
2. **Ship a local-built artifact**: `npm run build && git add -A && git commit && git push && ms app deploy`
3. **Ship a cloud-built artifact**: `git add -A && git commit && git push && ms app deploy [--commit <sha>]`
4. **Share with someone**: `ms app share <user@tenant.onmicrosoft.com>`
```

## Reading the Memory Bank

When reading the memory bank, extract:

1. **Project context**: Path, app name, environment, version.
2. **Completed work**: Check checkboxes to know what's done.
3. **User preferences**: Apply these without re-asking.
4. **Created resources**: Know what data sources/connectors exist.
5. **Environment id (reference only)**: Record the environment id the CLI resolved so it can be referenced later (e.g. to reconstruct the App Player URL). Do **not** use it to re-target a future `ms app create` — let the CLI resolve the environment automatically each time.

## Writing Guidelines

1. **Be concise**: Use tables and lists, not paragraphs.
2. **Be specific**: Include exact values, paths, GUIDs.
3. **Timestamp updates**: Always update "Last Updated".
4. **Preserve history**: Add to notes, don't overwrite.
5. **Track decisions**: Record why choices were made.
