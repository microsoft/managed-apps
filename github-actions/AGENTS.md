# Agent guide — github-actions

This directory holds the **`install-ms-cli`**, **`ms-app-pack`**, and
**`ms-app-deploy`** GitHub Actions for building and deploying Microsoft Managed
Apps from CI.

If you're an agent (GitHub Copilot CLI, Claude Code, or any other) helping with
this component, the reusable skills below are plain Markdown runbooks — read the
relevant one and follow its steps.

## Skills (`agent-skills/`)

| Skill | Use it when |
|---|---|
| [`agent-skills/release-guide.md`](agent-skills/release-guide.md) | Cutting a release PR — bump `package.json`, update the changelog, rebuild `dist/`, open the PR. |
| [`agent-skills/architecture.md`](agent-skills/architecture.md) | Understanding the end-to-end flow — setup, local dev, CI loops, the deploy sequence, and the release/versioning model (with diagrams). |

## Build & release essentials

- **Build the actions:** `cd github-actions && npm install && npm run build`
  (compiles `src/` and bundles each action into `dist/actions/<name>/index.js`).
- **`dist/` is committed** and referenced by each `action.yml`'s `main:` — always
  rebuild it after changing `src/`.
- **Versioning:** `package.json` is the single source of truth. Bump it to release;
  the release workflow tags `vX.Y.Z` and moves the `vX` alias on merge to `main`.
- See [`README.md`](README.md) for usage and inputs/outputs.
