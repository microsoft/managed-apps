# CRUD UI

Reference for [/add-database](../SKILL.md). Pass the
[Rayfin feature gate](../../../shared/shared-instructions.md#rayfin-feature-gate)
before using this guidance.

## Read the docs first

Use the entities and client from [data modeling](./rayfin-data-modeling.md).
The client API belongs to the installed packages; this reference covers the UI.
Paths are relative to the app root; complete the entry skill's `npm install` step
if dependencies are not installed.

Read `node_modules/@microsoft/<package>/package.json`, follow `rayfinDocs.dir`,
and open `index.md` before the relevant pages:

| Topic | Installed documentation |
| --- | --- |
| Paging, cursors and field nullability | `node_modules/@microsoft/rayfin-data/assets/docs/index.md` |
| Client entry point | `node_modules/@microsoft/rayfin-client/assets/docs/index.md` |

If `@microsoft/rayfin-guide` is already installed, read
`node_modules/@microsoft/rayfin-guide/assets/docs/data/graphql.md` for the query
and mutation walkthrough. It is optional, not supplied by the client dependency.
For missing API signatures, follow the installed package's `types` or `exports`
entry to its declarations. Report unresolved documentation gaps rather than
guessing APIs or installing the Rayfin CLI.

## The shape

Provide typed list/create/update/remove operations using the existing client.
Use the app's hooks for state and mutations, and components for rendering.

Show loading, empty and error states. For growing lists, use the package's paging
contract, keep filters and ordering stable, and include a unique sort tie-breaker.
Changing the query or signed-in identity must invalidate stale requests.

### Why optimistic

Optimistic updates show the user's action immediately without waiting for a
round-trip. Snapshot affected rows, apply the change locally, and roll back
visibly on failure. Replace temporary rows with the server-returned row.
Disable duplicate/conflicting submissions and avoid stale loads overwriting
successful mutations.

### Mutation result contract

Use the actual operation contract to decide whether a save succeeded. Do not
treat a resolved promise from an error-handling wrapper as proof of success.

Returned fields are authoritative. Merge partial mutation results with the
existing row or submitted draft; fetch missing server defaults when needed.
Do not compare every field with the submitted input and treat normalization,
rounding or generated defaults as a failed save.
A failed readback after a successful save is a refresh failure, not a reason to
repeat the write or claim rollback.

## Forms

Use controlled inputs with accessible labels. Validate against the entity's
constraints before submitting and disable submission while pending.
Keep errors near the relevant fields, preserve input on failure, and clear or
close the form only after confirmed success.

## Deleting

Confirm deletion with the record's name and consequence. Keep the row visible
until success, or restore it in its original position if an optimistic delete fails.

## Per-user data

Follow [server-side ownership](./rayfin-data-modeling.md#step-5-per-user-data).
Never use UI filtering as authorization. Clear private rows and pending results
when the session changes.

## Seed data

Seed only on explicit user action, not on mount or reload. Label sample rows,
stamp ownership, and use a deployed unique key for retry/concurrency safety.
An empty-list check alone does not prevent duplicate seeds.

## Rendering a row safely

Guard null and undefined values before reading properties or calling methods.
Convert dates, arrays and objects to app-specific display text; format numbers
for their units and render relationship labels instead of raw objects.
Format date-only values with UTC so the browser timezone cannot shift the day.

## Keep saved rows visible

Show newly saved records under the default view. If active filters exclude them,
explain why. Compare normalized date-only strings or UTC fields in date filters.
Do not hide database-backed rows because an unrelated connector or live data
source is unavailable.

## Checklist

- [ ] Loading, empty, error and pending states render; optimistic failures roll back.
- [ ] Forms have labels, match entity constraints and retain input on failure.
  Destructive actions confirm and name the record.
- [ ] Nullable and non-primitive fields render safely; date-only display and
  filtering do not shift with the browser timezone.
- [ ] Seeding is user-initiated and idempotent; default filters include newly
  saved rows independently of unrelated live data.
- [ ] Local fixtures cover partial results, write/readback failures, stale requests,
  and pagination across multiple pages, including empty pages and later-page retry.
- [ ] On an approved backend, with approval for test writes: create a row and reload,
  update it and reload, then delete it and reload. Verify each saved result.
- [ ] Include the [authentication and permission checks](./rayfin-data-modeling.md#check-authentication-and-permissions).

Follow the normal app build/deploy workflow and repeat runtime checks after app
deployment. Report unavailable checks as blocked; build/pack success or mocks do
not prove persistence.
