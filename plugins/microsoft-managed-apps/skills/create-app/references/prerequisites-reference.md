# Prerequisites Reference

## Required Tools

| Tool                  | Minimum Version | Check Command                                       | Install / Notes                                                              |
| --------------------- | --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Node.js               | **v22+**        | `node --version`                                    | https://nodejs.org/                                                          |
| Git                   | Any 2.x         | `git --version`                                     | https://git-scm.com/ — required (`ms app create` initializes a repo).        |
| Git Credential Manager | Bundled with Git for Windows | `git credential-manager --version`     | First `ms app create` triggers an interactive browser flow against the remote git endpoint. See [troubleshooting.md](./troubleshooting.md#first-run-git-credential-manager-trap). |
| `@microsoft/managed-apps-cli` | `@latest` tag      | `ms --version` | Install globally only — see below. |

## Required Account

- A Microsoft work/school account with access to a Microsoft Apps-enabled tenant.
- `ms app create` resolves an environment automatically — you do not need to know or provide one. (Advanced users who already have a specific environment ID can pass it via `--environment-id`.)

## Installing `@microsoft/managed-apps-cli`

The CLI is published on the public npm registry: [`@microsoft/managed-apps-cli`](https://www.npmjs.com/package/@microsoft/managed-apps-cli).

**Shell note:** the snippets below are shown in bash. If you're on PowerShell, use the equivalents called out in [shared-instructions.md](../../shared/shared-instructions.md#shell-compatibility) instead of copying the bash syntax literally.

### Global install (pinned to `@latest`)

```bash
npm install -g @microsoft/managed-apps-cli@latest
```

Install globally so the `ms` binary is on PATH. Subsequent `ms` invocations resolve the binary from the global install path.

### Daily refresh

```bash
LATEST=$(npm view @microsoft/managed-apps-cli@latest version 2>/dev/null | tr -d '\r')
```

PowerShell equivalent:

```powershell
$Latest = (npm view @microsoft/managed-apps-cli@latest version 2>$null).Trim()
```

If the installed version differs from `$Latest`, continue app creation with the compatible installed version and mention the available upgrade in the final summary. Upgrade only when the user explicitly asks; never auto-update.

### Override patterns (only with explicit user direction)

- Specific build for repro: `npm install -g @microsoft/managed-apps-cli@<version>`

### What NOT to do

- **Do NOT** run `npm install --save-dev @microsoft/managed-apps-cli` per-workspace. Install globally so the `ms` binary is on PATH and the per-app workspace stays clean.
- **Do NOT** use `npx ms` from inside a project — `npx` may resolve to an unrelated public-registry package named `ms` (a date-parser shim).

## Required Permissions (`allowedPrompts`)

When using plan mode, include these in `allowedPrompts`:

```json
{
  "allowedPrompts": [
    { "tool": "Bash", "prompt": "check tool versions (node, git, ms)" },
    { "tool": "Bash", "prompt": "install @microsoft/managed-apps-cli globally" },
    { "tool": "Bash", "prompt": "ms auth status / ms auth login" },
    { "tool": "Bash", "prompt": "ms app create / ms app delete (recovery)" },
    { "tool": "Bash", "prompt": "npm install / npm run build" },
    { "tool": "Bash", "prompt": "ms app dev (local dev server)" },
    { "tool": "Bash", "prompt": "git fetch / git config (first-run GCM recovery)" }
  ]
}
```
