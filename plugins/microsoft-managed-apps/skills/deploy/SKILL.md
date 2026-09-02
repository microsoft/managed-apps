---
name: deploy
description: Ships a Microsoft App to the cloud. Use when the user asks to deploy via `ms app deploy` (with optional build-status traceability flow).
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns. **Always confirm before deploy.**

# Deploy

Builds and deploys the app in the current directory.

Before any deploy, sync source control first: stage all changes, create a commit, and push to remote.

## Workflow

1. Memory Bank → 2. Verify Project + Env → 3. Pick Path → 4. Shared Connection Policy Preflight → 5. Build Verification → 6. Git Sync (Add + Commit + Push) → 7. Confirm + Deploy → 8. Update Memory Bank

---

### Step 1: Check Memory Bank

Read `memory-bank.md` for app slug, GUID, environment, and version.

### Step 2: Verify Project + Env

```bash
test -f ms.config.json || { echo "Not in a Microsoft App workspace."; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Not in a git repository."; exit 1; }
BIN=ms
$BIN auth status                                         # must report the expected UPN
```

If auth is stale or the wrong account, stop and have the user run `$BIN auth login`.

### Step 3: Pick a Deploy Path

Ask the user which path:

| Path                                        | When                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Standard deploy** (`ms app deploy [--commit <sha>]`) | Default. Use for normal release flow. `--commit` defaults to `git rev-parse HEAD`. |
| **Traced deploy** (`ms app build` + `ms app build-status` + `ms app deploy`) | Use when the user needs explicit build-id tracking before deploy. |

`ms app build -c <sha>` + `ms app build-status -o <build-id>` is a third (older) two-step variant for the cloud-built path. The `build` subcommand is marked deprecated in the CLI source but still works; use it only when the user wants an explicit build-id to track. Otherwise, `ms app deploy` is the single-step replacement.

### Step 4: Shared Connection Policy Preflight

`ms app deploy` validates that every **shared** connection reference declares `allowedActions`,
and fails the deploy when one doesn't. Catch it here — before spending a build and a push on a
deploy that can't succeed.

```bash
node -e '
const fs = require("fs");
const refs = JSON.parse(fs.readFileSync("ms.config.json", "utf8")).connectionReferences || {};
const ok = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => String(x).trim());
let bad = 0;
for (const [name, r] of Object.entries(refs)) {
  if (!String(r.sharedConnectionId || "").trim()) continue;
  const t = Object.entries(r.dataSets || {}).flatMap(([d, s]) =>
    Object.entries(s.dataSources || {}).map(([k, v]) => [d + "/" + k, v]));
  if (t.length) {
    for (const [p, v] of t) if (!ok(v.allowedActions)) { bad++; console.log("MISSING per-table allowedActions: " + name + " -> " + p); }
  } else if (!ok(r.allowedActions)) { bad++; console.log("MISSING connector-level allowedActions: " + name); }
}
console.log(bad ? bad + " issue(s): fix before deploy" : "OK: all shared references declare allowedActions");
'
```

This mirrors the CLI's own validation and works in bash and PowerShell alike (Node 22+ is a
project prerequisite; `jq` is not).

Any `MISSING` line means the deploy will fail. **Stop and fix it** rather than proceeding:

- `per-table` → the reference has dataset tables. Every table needs its own non-empty list
  from `"get"` / `"post"` / `"patch"` / `"delete"`.
- `connector-level` → no dataset tables. Declare Action IDs from
  `ms connector list-actions --connector <api-id> --json`.

Infer the least-privilege set from what `src/` actually calls, propose it, and confirm with the
user before writing. Do **not** grant everything to get past the gate, and do **not** delete
`sharedConnectionId`. See [allowed-actions.md](${CLAUDE_PLUGIN_ROOT}/shared/allowed-actions.md).

`OK` means every shared reference is covered — continue.

### Step 5: Build Verification

```bash
npm run build
```

Failure handling per [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md):

- TS6133 (unused import): remove and retry once.
- Other TS errors: report file:line, STOP.
- Module not found: `npm install` and retry once.
- Other non-zero exit: report verbatim, STOP.

Verify the build output directory (`./dist` by default, or whatever `--build-path` resolved to during `ms app create`) is populated before continuing.

### Step 6: Git Sync (Add + Commit + Push)

Deploy must use a pushed commit. Always sync local changes first.

```bash
if [ -n "$(git status --porcelain)" ]; then
	git add -A
	git commit -m "$COMMIT_MESSAGE"
fi

# Ensure the deployment commit exists on remote.
git push -u origin HEAD
DEPLOY_SHA="$(git rev-parse HEAD)"
```

If there are local changes, ask for a commit message before running `git commit`. If the user does not provide one, use:

```text
chore: prepare deploy
```

If `git commit` reports "nothing to commit", continue to push/verify the current `HEAD`.

### Step 7: Confirm + Deploy

**Always ask explicitly before deploy** — there is no baseline-deploy exemption in this plugin:

> "Ready to deploy `<app-name>` to `<environment-name>` (`<env-id>`)? This will update the live app."

Wait for explicit user yes.

**Standard deploy:**

```bash
$BIN app deploy --commit "$DEPLOY_SHA"
```

**Traced deploy with build-id traceability:**

```bash
$BIN app build -c "$DEPLOY_SHA"                     # returns a build-id
$BIN app build-status -o "$BUILD_ID"                # polls until terminal state
$BIN app deploy --commit "$DEPLOY_SHA"              # promote the built commit
```

Capture and surface any URLs / build IDs from the output.

After a successful deploy, offer to open the live app:

```bash
$BIN app play                # opens the live URL in the browser
$BIN app play --no-browser  # print URL only
```

If the user wants to verify the code before making it live, remind them they can preview without deploying:

```bash
$BIN app play --mode preview   # opens the latest code on main (no deploy needed)
```

### Step 8: Update Memory Bank

If `memory-bank.md` exists:

- Increment version (e.g., `v1.0.0` → `v1.1.0`) per [development-standards.md](${CLAUDE_PLUGIN_ROOT}/shared/development-standards.md). Bump the version display in the app UI too.
- Update "Last deployed" timestamp.
- Record the deploy path used (standard / traced).
- Capture the commit SHA at deploy time.

If no memory bank exists, create one per [memory-bank.md](${CLAUDE_PLUGIN_ROOT}/shared/memory-bank.md) so subsequent skills have context.

---

## Failure Recovery

| Error                                                  | Fix                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ms app deploy`: 401 / token expired                     | `$BIN auth login` and retry.                                                                                                              |
| `ms app deploy`: `Invalid ms.config.json for shared connection policy enforcement` | A shared connection reference is missing `allowedActions`. The listed issues name the reference (and dataset/table) at fault. Declare them per [allowed-actions.md](${CLAUDE_PLUGIN_ROOT}/shared/allowed-actions.md) and retry. Never remove `sharedConnectionId` to bypass this. |
| `ms app deploy`: env mismatch                            | Active CLI env doesn't match `ms.config.json`. Either re-create/redeploy against the matching environment, or update `ms.config.json`. |
| `git push`: no upstream configured                      | Run `git push -u origin HEAD`, then retry deploy.                                                                                         |
| `git commit`: author identity unknown                   | Configure Git identity (`git config --global user.name` / `git config --global user.email`) and retry commit.                            |
| `ms app deploy`: commit not in remote                  | Ensure Step 6 (Git Sync) completed and push succeeded, then retry.                                                                        |
| `ms app build-status`: 404                             | Build was submitted to a different cluster than you're querying. Verify the `--cloud` value matches the cluster used at build time.    |
| `ms app deploy`: 403 / not authorized on environment     | The account lacks Maker permissions in the target env. Confirm with `$BIN app list --json` — if the app doesn't appear, you're not authorized. |
