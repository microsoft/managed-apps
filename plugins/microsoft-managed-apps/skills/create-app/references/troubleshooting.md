# Troubleshooting

## First-Run Git Credential Manager Recovery

**The most common failure on the first `ms app create` for a new account.**

**Shell note:** if you are in PowerShell and see `export: command not found`, you are looking at a bash-only snippet. Rerun the command without the `export` prefix, or use the PowerShell equivalents from [prerequisites-reference.md](./prerequisites-reference.md).

### Symptom

```
fatal: Authentication failed for 'https://<env-id>.d.environment.api.powerplatform.com/appframework/git/repositories/<repo-guid>/'
Could not commit and push the initial scaffold. Your app and local scaffold are ready.
```

### Cause

`ms app create` provisions the app and writes a `[credential ...]` block to `.git/config` pointing at the right OAuth client + scopes. But Git Credential Manager has to run its interactive browser flow at least once to mint a token for the remote endpoint. On the very first run for that user/tenant/cluster combo, GCM hasn't done that flow, so `git fetch origin` can 401 while reconciling the already-created local scaffold with the remote.

The app and local scaffold remain intact. Do **not** delete the app, remove the project directory, or rerun `ms app create`.

### Recovery

```bash
# Trigger GCM's interactive browser flow against the remote.
git fetch origin # browser opens; approve.
```

### Detection

Match `Could not commit and push the initial scaffold` together with `Authentication failed for 'https://` followed by `.d.environment.api.`, or `push.success: false` in `--json` output. Surface `git fetch origin` and continue with the existing app.

---

## Common `ms app create` Failures

| Error                                                                             | Cause                                                                                  | Fix                                                                                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `defau.lt.environment.api.powerplatform.com: no such host` (or similar DNS error) | A malformed `--environment-id` value was passed (this only happens when the user supplied one). | Surface the error. Drop the explicit `--environment-id` and let `ms app create` auto-route, or have the user supply a valid environment ID. |
| `Could not provision a Developer environment for your tenant (status 403)`        | Routing service rejected the account. Tenant Governance may block Developer envs.      | Surface the error to the user — provisioning is blocked at the tenant level and the plugin cannot work around it. The user (or their tenant admin) needs to resolve the governance/access issue. |
| `Directory not empty; pass --force`                                               | Current project folder has prior files.                                                 | Run `/create-app` from an empty folder, or confirm using `--force` only when you intend to overwrite.                    |
| Repo init fails (`fatal: not in a git repository`)                                | Git is missing or `git config user.email` / `user.name` are unset.                     | Install Git; run `git config --global user.email "<you>@microsoft.com"` and `... user.name "<You>"`.                       |

## Common Build / Dev Failures

| Problem                                                              | Solution                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm install` fails with `EACCES` or permission errors               | Don't `sudo`. Use `nvm` or fix the global prefix (`npm config get prefix`).                              |
| `npm run build` fails with TS6133 (unused import)                    | Remove the unused import and retry once.                                                                 |
| `npm run build` fails with module-not-found                          | Run `npm install` and retry.                                                                             |
| `ms app dev` exits immediately with port-in-use                      | Pass `--port <other>` or kill whatever's on 8080.                                                        |
| `ms app dev` connector calls return 401/403 in the browser           | Maker-portal session expired. Sign in again at `https://make.powerapps.com`, then refresh the App Player tab. |
| Binary "command not found" after `npm install -g`                    | `npm config get prefix` directory's `bin` isn't on PATH. On Windows, default is `%APPDATA%\npm` — usually added by the Node installer, but a manual install or PowerShell-profile override can break this. |
| `npx ms ...` resolves to an unrelated package                        | Don't use `npx ms`; use the globally-installed binary directly. The public-registry `ms` is a date-parser shim. |

## Auth Failures

| Symptom                                                                          | Fix                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ms auth status` reports the wrong UPN                                           | `ms auth login` (interactive). Don't rely on cached state across tenants — always check `auth status` first. |
| `ms auth login` browser flow times out                                           | Re-run; the underlying MSAL flow has a finite window. If a popup blocker is involved, allow it for `login.microsoftonline.com`. |
| Token works for `ms app list` but `ms app create` returns 403                    | The account lacks Maker permissions in the target tenant. Either pick a different account or escalate access. |

## Resources

- **Connectors reference**: https://learn.microsoft.com/en-us/connectors/connector-reference/
- **Dataverse docs**: https://learn.microsoft.com/en-us/power-platform/
