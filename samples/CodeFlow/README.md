# CodeFlow

An iteration-aware pull request review app for **GitHub** — an app hosted on
**Copilot Managed Runtime** (React + Vite + TypeScript), built on the public **GitHub connector**
(`shared_github`).

> **Preview:** Copilot Managed Runtime is in public preview. Features, the `ms` CLI and the
> `@microsoft/managed-apps*` packages may change. See the
> [Quickstart](https://go.microsoft.com/fwlink/?LinkId=2368962) and the
> [documentation](https://go.microsoft.com/fwlink/?LinkId=2372842).

This is a sample: clone it, connect it to your own environment and GitHub account, and adapt it.

## What it demonstrates

- A connector-backed UI where **every** connector call goes through one small adapter
  (`src/connectors/github.ts`), so the rest of the app — and the tests — never touch generated
  code.
- A pluggable **storage interface** (`src/storage`): data stays in the browser by default and can
  be moved to SharePoint, Dataverse or your own API with the bundled `add-data-source` skill,
  without touching UI code.
- Diffing, iteration tracking, syntax highlighting (Shiki, grammars loaded on demand),
  Markdown rendering without raw HTML, and a large unit-test suite (Vitest + Testing Library).

## Features

- **Dashboard** — review requests, your PRs, PRs you reviewed, in-progress reviews, flagged PRs,
  recently viewed PRs and pinned repositories. Jump to any PR by `octo-org/octo-repo#123` or by
  pasting its URL.
- **Iterations** — each commit on the PR branch is an iteration (the base is Iteration 0).
  Compare any two iterations; "new since your last review" counts commits after the iteration
  you last reviewed. Force-pushes are detected and reported.
- **File list** with change badges, `+`/`−` counts, a name filter (with invert), and
  **mark as seen**. Seen marks carry forward across pushes when a file's diff did not change.
- **Diff viewer** — inline or side-by-side, whitespace-insensitive mode, word-level diff,
  syntax highlighting, find-in-file, full-file expansion, and Markdown preview with comments.
- **Compare any two changed files** side by side (e.g. `v2.sql` vs `v3.sql`).
- **Comment threads** — single- and multi-line comments, replies, edits, deletes, and status
  (active / resolved / closed). A comment summary panel filters by status, level and author.
- **Checks** — required vs optional checks for the PR head, with links to each check.
- **Merge, auto-merge, publish draft, cherry-pick** (with an optional follow-up PR).
- **App-only author approval** — the PR author can record "approved (app only)" for a head
  commit. This is stored by the app, never sent to GitHub, and does not count toward GitHub's
  merge rules.
- **Notes & feedback** — a small list of bugs, ideas and questions with comments and a simple
  status, stored like the rest of the app's data.
- **Settings** — theme, code font and ligatures, diff defaults, refresh cadence, and
  **Data → Export / Import**.
- **Deep links** — `?org=<owner>&repo=<repo>&pull=<number>[&file=<path>][&comment=<id>]`.

## Architecture

```
src/
  connectors/github.ts   The only module that uses connector codegen (generated/). Defines the
                         GitHubClient interface; tests replace it with fakes.
  services/              Domain services over GitHubClient: PRs, compare, checks (GraphQL),
                         comments and reviews (GraphQL), merge, cherry-pick, feedback
  storage/
    core/                Shared storage core (provider interface, local + memory providers,
                         contract tests). Synced from the template set; do not edit.
    collections.ts       Every stored collection as a zod schema
    index.ts             createStorage(): picks the provider from VITE_STORAGE_PROVIDER
    mirror.ts            Synchronous in-memory view of a collection with write-through
  state/                 CodeFlowProvider plus focused hooks (load, iterations, files, comments,
                         reviews, merge, checks, polling, deep links)
  components/            Dashboard, Layout, FileList, IterationBar, DiffViewer, CommentThread, …
  settings/              Settings document (stored in the `prefs` key/value namespace)
  config.ts              Typed configuration from VITE_* variables
  lib/                   logger (silent in production builds) and safeUrl
scripts/
  check-setup.mjs        Runs before dev/build; explains what setup is missing
  storage-describe.ts    Prints every collection as JSON Schema (npm run storage:describe)
```

```
UI components ──► state hooks ──► services ──► connectors/github.ts ──► generated/ (local only)
                       │
                       └──────────► utils/storage, settings ──► storage provider (local by default)
```

## Setup

The short version is below; `.github/skills/setup-codeflow/SKILL.md` has the full steps and can be
run by a coding agent. For AI-assisted setup you can optionally install this repository's agent
plugin ([`../../plugins/microsoft-managed-apps`](../../plugins/microsoft-managed-apps)).

The sample ships without `ms.config.json` or connector code; the steps below create them for your
environment. Your app gets its own platform-managed git repository, and you commit everything to
it except `.env.local`.

1. **Prerequisites:** Node.js 24.11+, npm, git, access to a Power Platform environment where you
   can create apps on Copilot Managed Runtime, and a GitHub account.
2. **Copy the sample into its own folder.** It becomes your app's repository, so it can't stay
   inside a clone of this samples repository:

   ```bash
   git clone --depth 1 https://github.com/microsoft/Managed-Apps
   cp -r Managed-Apps/samples/CodeFlow my-codeflow   # PowerShell: Copy-Item -Recurse Managed-Apps/samples/CodeFlow my-codeflow
   cd my-codeflow
   ```

3. **Install:** `npm install`
4. **Sign in:** `npx ms auth login`
5. **Create the app.** This creates the app, its platform-managed git repository (set up as
   `origin`) and `ms.config.json`:

   ```bash
   npx ms app init --display-name "CodeFlow" --icon-path ./public/codeflow-logo.png
   ```

   Optionally add `--environment-id <id>` to pick the environment without a prompt.
6. **Hide the host header** (CodeFlow draws its own):

   ```bash
   npx ms app set-setting --show-header false
   ```

7. **Add the GitHub connector (required):**

   ```bash
   npx ms app add data-source --connector shared_github --as action
   ```

   This generates `generated/` and `.ms/`; commit them with the app. The CLI asks you to pick or
   create a GitHub connection. If it reports actions "skipped due to your organization's
   connector policy", `npm run check-setup` tells you whether CodeFlow needs any of them.
8. **Configure (optional):** `cp .env.example .env.local` and adjust.
9. **Check and run:**

   ```bash
   npm run check-setup
   npm run dev        # or: npx ms app dev
   ```

   Open the **Local Play** URL that the dev server prints to run the app inside the player with
   the live connector.
10. **Commit and push** to your app's repository (git asks you to sign in the first time), then
    deploy from the pushed commit:

    ```bash
    git fetch origin
    git reset origin/main   # start from the new repository's initial commit; your files stay as they are
    git branch -M main
    git add -A
    git commit -m "Set up CodeFlow"
    git push -u origin main
    npm run build && npx ms app deploy
    ```

`npm run dev` and `npm run build` run `check-setup` first and stop with the steps above if
something is missing. `npm test` and `npm run lint` work without any setup.

## Connector operations used

CodeFlow uses only these operations of the GitHub connector (`shared_github`):

| Operation | Used for |
| --- | --- |
| `GetUser` | The signed-in GitHub identity (votes, authorship, mentions) |
| `GetPullRequest`, `GetPullRequests` | PR details and repository PR lists |
| `SearchIssues` | Dashboard queues (`is:pr review-requested:@me`, …) |
| `CompareRepositoryCommits` | Changed files and iterations |
| `MergePullRequest` | Merge (guarded by the expected head SHA) |
| `ListCollaborators`, `checkCollaborator` | @mention suggestions |
| `CreateReference`, `CreatePullRequest` | Cherry-pick branches and follow-up PRs |
| `SearchGithubWithQuery` | GraphQL queries and mutations (below) |

GraphQL documents sent through `SearchGithubWithQuery` (values are inlined; the operation takes
no variables):

| Feature | GraphQL |
| --- | --- |
| Read comments | `pullRequest { reviewThreads { … comments { … } } comments { … } }` (paged) |
| New diff comment | `addPullRequestReview` (pending) → `addPullRequestReviewThread` → `submitPullRequestReview` (`COMMENT`); `deletePullRequestReview` discards the pending review on failure |
| Reply | `addPullRequestReviewThreadReply`; Description replies use `addComment` |
| PR-level comment | `addComment` |
| Resolve / reactivate | `resolveReviewThread` / `unresolveReviewThread` |
| Edit | `updatePullRequestReviewComment` / `updateIssueComment` |
| Delete | `deletePullRequestReviewComment` / `deleteIssueComment` |
| Votes | read `pullRequest { reviews }`; submit `addPullRequestReview(event: APPROVE \| REQUEST_CHANGES \| COMMENT)` |
| Changed files | `pullRequest { files }` (complements compare, which caps at about 300 files) |
| File contents | `object(expression: "<ref>:<path>") { ... on Blob }` |
| Branches | `refs(refPrefix: "refs/heads/")`, `ref(qualifiedName:)` |
| Cherry-pick | `createCommitOnBranch` (one commit, `expectedHeadOid`); on failure `ref { id }` + `deleteRef` |
| Checks, auto-merge, publish draft | `statusCheckRollup`, `enablePullRequestAutoMerge` / `disablePullRequestAutoMerge`, `markPullRequestReadyForReview` |

The token scopes are those of the connector's GitHub OAuth app; the app can't request more.

**Least privilege:** the connection acts as the GitHub user who created it; the app can do only
what that user can do. Don't add connector operations the app doesn't call, and review
`src/connectors/github.ts` before extending it.

### Capability notes and gaps

- **Branches and file contents** use GraphQL (`refs(refPrefix: "refs/heads/")` and
  `object(expression: "<ref>:<path>")`), because the public connector has no raw-file or
  list-branches operation. Binary files and blobs GitHub won't return as text show as
  unavailable rather than as content.
- **Comment sync** goes to GitHub whenever GraphQL succeeds. Only when GitHub genuinely can't be
  read (offline, no permission, an API error) do comments fall back to **local comments** stored
  by the app, and the header shows "Local (this device)".
- **Cherry-pick** writes text files only: GraphQL returns no binary content, so a pull request
  that changes a binary file is refused cleanly before anything is written. Each file is merged
  three-way against the pull request's base, so changes already on the target are kept and a
  real conflict (including a file the target doesn't have) refuses the whole cherry-pick. The
  cherry-pick is one `createCommitOnBranch` commit; if it fails, the new branch is deleted again.
- **Comments on lines outside the diff:** GitHub's API can't anchor a review comment there, so the
  app posts a file-level comment with a hidden marker naming the line, and re-anchors it on read.
- **Branch names with `/`** (for example `release/1.0`) can't be passed to the connector's
  path-based REST operations, so the app resolves branches to commits through GraphQL first.
- **Large PRs:** GitHub caps compare results (about 300 files / 250 commits). The complete file
  list is read through GraphQL; files beyond the compare cap are listed without a diff.

## Storage modes and privacy

All app-owned data goes through the storage interface:

| Collection / namespace | Holds |
| --- | --- |
| `reviewState` | Per PR (`owner/repo#number`): seen marks, last reviewed iteration, iteration history, local comments, recent/flagged/in-progress markers |
| `prNotes` | Per PR: which comment threads were closed in the app, and by whom |
| `approvals` | App-only author approvals (append-only) |
| `feedback`, `feedbackComments` | Notes & feedback items and their replies |
| `prefs` (key/value) | Settings and pinned repositories |
| `drafts` (key/value) | Unsent comment text (expires after 14 days) |
| `ui` (key/value) | Pane sizes and collapsed sections |

- **Local mode (default, `VITE_STORAGE_PROVIDER=local`)** keeps everything in this browser's
  storage under the `VITE_APP_STORAGE_PREFIX` prefix. Nothing is shared with other reviewers —
  the app says so with a "Local mode: data stays in this browser" notice. Clearing site data
  removes it; use **Settings → Data → Export** to keep a copy.
- **Shared mode:** follow `.github/skills/add-data-source/SKILL.md` to add a SharePoint,
  Dataverse or custom-API provider, then **Import** your export. Who can read or change shared
  data is decided by the backend's permissions, not by the app's UI.
- GitHub data (PRs, comments, reviews) is read live through the connector and is not copied
  into app storage, except local comments when GitHub comment sync is unavailable.
- Run `npm run storage:describe` to print every collection's JSON Schema.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_APP_NAME` | `CodeFlow` | Name shown in the header |
| `VITE_GITHUB_HOST` | `https://github.com` | GitHub web origin for links when the API gives none |
| `VITE_APP_URL` | *(empty)* | Deployed app URL used for shareable deep links |
| `VITE_DEV_PLAYER_URL` | `https://play.preview.managedapps.cloud.microsoft` | Player used for share links during `npm run dev` (the same host the Vite plugin prints as "Local Play") |
| `VITE_STORAGE_PROVIDER` | `local` | Storage provider id registered in `src/storage/index.ts` |
| `VITE_APP_STORAGE_PREFIX` | `codeflow` | Prefix isolating this app's browser storage |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Local development (runs `check-setup` first) |
| `npm run build` | Type-check and build to `dist/` (runs `check-setup` first) |
| `npm run check-setup` | Verify `ms.config.json` (from `ms app init`) and the GitHub connector codegen |
| `npm run typecheck` | `tsc -b` (needs the connector codegen) |
| `npm run lint` | ESLint, including storage and connector boundary rules |
| `npm test` | Vitest (no setup or codegen needed) |
| `npm run storage:describe` | Print collections as JSON Schema |
| `npm run verify` | Lint, test and build |

## Customizing

- Add GitHub features in `src/services/*` against the `GitHubClient` interface; add the connector
  operation to `src/connectors/github.ts` only when you need a new one.
- Add stored data by declaring a collection in `src/storage/collections.ts`.
- Lint rules block `localStorage`/`sessionStorage` outside storage providers, `/.ms/` routes,
  imports of `generated/` outside `src/connectors`, and `any`.

## License

This sample is licensed under the MIT license; see [LICENSE](../../LICENSE) at the root of the
repository.
