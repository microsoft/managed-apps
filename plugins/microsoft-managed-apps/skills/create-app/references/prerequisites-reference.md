# Prerequisites Reference

## Required Tools

| Tool                  | Minimum Version | Check Command                                       | Install / Notes                                                              |
| --------------------- | --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Node.js               | **v22+**        | `node --version`                                    | https://nodejs.org/                                                          |
| Git                   | Any 2.x         | `git --version`                                     | https://git-scm.com/ — required (`ms app create` initializes a repo).        |
| Git Credential Manager | Current release | `git credential-manager --version`                 | Required for browser-based remote authentication. Bundled with Git for Windows; otherwise install from https://aka.ms/gcm. |
| GCM credential helper | Configured at system or global scope | `git config --system --get-regexp '^credential(\..*)?\.helper$'` and `git config --global --get-regexp '^credential(\..*)?\.helper$'` | Combined output must contain `manager` or `credential-manager`. Run `git credential-manager configure` if it does not. |
| Git author name       | Configured globally | `git config --global --get user.name`              | Required for the initial scaffold commit.                                    |
| Git author email      | Configured globally | `git config --global --get user.email`             | Required for the initial scaffold commit.                                    |
| `@microsoft/managed-apps-cli` | `@latest` tag      | `ms --version` | Install globally only — see below. |

## Required Account

- A Microsoft work/school account with access to a Microsoft Apps-enabled tenant.
- `ms app create` resolves an environment automatically — you do not need to know or provide one. (Advanced users who already have a specific environment ID can pass it via `--environment-id`.)

## Git prerequisite checks

Run these checks before `ms app create`:

```bash
git credential-manager --version
git config --system --get-regexp '^credential(\..*)?\.helper$'
git config --global --get-regexp '^credential(\..*)?\.helper$'
git config --global --get user.name
git config --global --get user.email
```

- If GCM is missing, warn that Git may fall back to a username prompt and ask for approval to install it. On approval, use the official OS-appropriate installation method, run `git credential-manager configure`, and repeat the checks. If declined, stop.
- If GCM exists but the combined system/global helper output does not contain `manager` or `credential-manager`, warn the user and ask for approval to run `git credential-manager configure`. Repeat the checks after configuration. An individual scope returning no entries is not itself a failure.
- If either author value is empty, ask the user for the correct value before configuring it. Never infer an email address or name.

### GCM repair commands

Use these only after explicit user approval:

```bash
# Windows with WinGet
winget install --id Git.GCM --exact --source winget \
  --accept-package-agreements --accept-source-agreements

# macOS with Homebrew
brew install --cask git-credential-manager

# After installation, or when GCM is installed but not configured
git credential-manager configure
```

For Linux, use an official package from the [GCM installation documentation](https://aka.ms/gcm). Do not pipe a remote install script directly into a shell. Always repeat the GCM version and system/global helper checks after a repair.

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

If the installed version differs from `$Latest`, ask the user before upgrading. The `@latest` tag updates regularly.

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
    { "tool": "Bash", "prompt": "check Git Credential Manager, credential helper, and author identity" },
    { "tool": "Bash", "prompt": "install or configure Git Credential Manager and Git author identity" },
    { "tool": "Bash", "prompt": "install @microsoft/managed-apps-cli globally" },
    { "tool": "Bash", "prompt": "ms auth status / ms auth login" },
    { "tool": "Bash", "prompt": "ms app create / ms app delete (recovery)" },
    { "tool": "Bash", "prompt": "npm install / npm run build" },
    { "tool": "Bash", "prompt": "ms app dev (local dev server)" },
    { "tool": "Bash", "prompt": "git fetch / git config (first-run GCM recovery)" }
  ]
}
```
