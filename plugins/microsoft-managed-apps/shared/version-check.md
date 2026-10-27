# Version Check

**Run this check at the start of every skill execution, but at most once per day.**

## Instructions

### Step 1: Check if a version check is needed

Look for the file `~/.microsoft-managed-apps-last-version-check`. Read it if it exists.

- If the file exists and contains today's date (YYYY-MM-DD format), **skip the entire check** and continue with the skill silently.
- If the file does not exist, or the date is older than today, proceed to Step 2.

### Step 2: Read the local version

Read [the canonical plugin manifest](../plugin.json) and extract the `version` field.
Resolve this path relative to this instruction file, not the user's project.

### Step 3: Fetch the latest version from the marketplace

Fetch the remote marketplace manifest:
```
https://raw.githubusercontent.com/microsoft/Managed-Apps/main/.claude-plugin/marketplace.json
```
Use the `WebFetch` tool with the prompt: "Return only the version string for the plugin whose name is 'microsoft-managed-apps'."

### Step 4: Compare versions

Compare the local version against the remote version using semver rules — split on `.`, compare major, then minor, then patch as integers.

### Step 5: Display result

**If a newer version is available**, print this banner **before any other output**:

```
╔══════════════════════════════════════════════════════════════╗
║  UPDATE AVAILABLE: v{local} → v{remote}                      ║
║  Run your CLI's plugin update command for microsoft-managed-apps ║
╚══════════════════════════════════════════════════════════════╝
```

**If versions match or the local version is newer**, print nothing.

### Step 6: Update the timestamp

Write today's date (YYYY-MM-DD) to `~/.microsoft-managed-apps-last-version-check` so subsequent skill runs today skip the check.

## Error Handling

If anything in Steps 2-4 fails (network error, file not found, malformed JSON), skip the check silently and continue with the skill. **Never block skill execution over a version check failure.**
