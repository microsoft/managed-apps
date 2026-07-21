# Release guide — github-actions

How to cut a release PR for the actions under `github-actions/`: bump the
version, update the changelog, rebuild the esbuild bundles, and open a PR from a
fresh branch off `origin/main`. The version bump is what the release workflow
keys on, so this procedure keeps `package.json`, `CHANGELOG.md`, and `dist/` in
lockstep.

This is a plain runbook — follow it by hand, or hand it to any coding-agent CLI
(GitHub Copilot CLI, Claude Code, etc.) and let it execute the steps.

## Inputs

- **bump** (required): `patch`, `minor`, or `major`.
  - patch = bug fix (no surface change)
  - minor = new backward-compatible capability
  - major = breaking change
- **summary** (optional): one line describing the change; used for the changelog
  entry and PR title.

If you don't know the bump type, decide it against the contract above — don't guess.

## Procedure

Run in order. If any step fails, stop and report exactly what failed — never
leave a half-prepared branch pushed.

### 1. Resolve inputs
- Settle on the `bump` type and a one-line `summary`.

### 2. Preflight
- `gh auth status` — confirm authenticated; abort if not.
- `git status --porcelain` — note whether the working tree has changes. Any
  uncommitted changes are the code being released and will be carried onto the
  new branch. If the tree is clean, this will be a **version-bump-only** PR —
  confirm that's intended before continuing.

### 3. Compute the new version
- Read current: `node -p "require('./github-actions/package.json').version"`.
- Apply the bump → `<NEW>`:
  - patch → `x.y.(z+1)`
  - minor → `x.(y+1).0`
  - major → `(x+1).0.0`

### 4. Branch from latest origin/main
- `git fetch origin`
- `git checkout -b "release/github-actions-v<NEW>" origin/main`
  - This carries any uncommitted working-tree changes onto the new branch.
  - If the branch name already exists, append `-2`, `-3`, … or pick another.

### 5. Bump package.json
- Set `github-actions/package.json` `"version"` → `<NEW>`.

### 6. Update CHANGELOG.md (`github-actions/CHANGELOG.md`)
- Get today's date: `date +%F`.
- Rename `## [Unreleased]` → `## [<NEW>] - <today>`.
- Insert a fresh, empty `## [Unreleased]` heading above it.
- Ensure the change is described under the new version using
  `### Added` / `### Changed` / `### Fixed` / `### Removed`, framed by what a
  consumer pinning `@v<major>` would notice. Fold in the summary and any bullets
  already accumulating under `[Unreleased]`.

### 7. Rebuild bundles
- `cd github-actions && npm ci && npm run build`
  (required so the release workflow's `dist/` drift-guard passes).
- Sanity check: `git status --porcelain github-actions/dist` — fine whether or
  not it changed; the point is `dist/` now matches source.

### 8. Commit, push, open PR
- `git add -A`
- Commit with a clear message (and your team's standard commit trailer).
- `git push -u origin "release/github-actions-v<NEW>"`
- Open the PR against `main`:
  - `gh pr create --base main --title "github-actions v<NEW>: <summary>" --body "<body>"`
  - Body: what changed, the version bump (`<old> → <NEW>`), and a note that the
    matching `CHANGELOG.md` entry is included.
  - If `gh pr create` fails on the Projects-classic GraphQL deprecation, retry
    via REST: `gh api -X POST repos/{owner}/{repo}/pulls -f title=... -f head=... -f base=main -F body=@<file>`.
- Report the PR URL.

## Notes
- Touch **only** `github-actions/` — do not bump versions or changelogs elsewhere
  in the repo.
- The new `package.json` version must not already have a `v<NEW>` tag (the release
  workflow fails otherwise). If it does, choose a higher bump.
- This prepares the PR; it does not merge. The release tag + `v<major>` alias are
  created by the release workflow when the PR merges to `main`.
