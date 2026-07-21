# Changelog

All notable changes to the Managed Apps GitHub Actions (under `github-actions/`)
are documented here. This project follows [Semantic Versioning](https://semver.org)
and the format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The version here mirrors `github-actions/package.json`. Add/extend the entry for
the new version **in the same PR that bumps the version**, before it merges to
`main` (see "Updating this changelog" at the bottom).

## [Unreleased]

## [1.0.1] - 2026-06-22

Initial release of the Managed Apps GitHub Actions.

### Added
- `install-ms-cli` — installs `@microsoft/managed-apps-cli` (binary: `ms`) on the
  runner. Supports the public npm registry and private Azure DevOps Artifacts
  feeds (`_password`/PAT vs. bearer `_authToken`, chosen by strict hostname match).
- `ms-app-pack` — runs `ms app pack` to build the app and stage the packed artifact.
- `ms-app-deploy` — runs `ms app deploy` with `--artifact`, `--commit`, or
  CLI-internal pack modes, selected from `repoType` in `ms.config.json`.
  Outputs `app-id`, `environment-id`, `commit-sha`, and `app-play-uri`.

### Fixed
- `ms-app-deploy` now parses the CLI's streamed `--json` output correctly — the
  CLI emits NDJSON progress lines followed by a multi-line result object, which
  the previous greedy parse spliced into one invalid blob and failed on. It now
  extracts the last valid JSON object, and reads `appId` (the CLI's field name)
  plus sources `environment-id` from `ms.config.json`.

### Notes
- Actions run on the `node24` runtime; esbuild bundles target `node24`.
- Shared env-var constants live in a side-effect-free `src/shared/env.ts`, so the
  `ms-app-pack` / `ms-app-deploy` bundles never embed the installer's entry point.

---

## Updating this changelog

- Edit this file **in the same PR** that changes anything under `github-actions/`.
- While developing, add lines under **`[Unreleased]`**.
- When you bump `version` in `package.json`, rename the `[Unreleased]` block to the
  new version with today's date, and start a fresh empty `[Unreleased]` above it.
- Group entries under `Added` / `Changed` / `Fixed` / `Removed`, and frame them by
  what a consumer pinning `@v1` would notice.
- The release workflow does **not** touch this file — it's maintained by hand.
