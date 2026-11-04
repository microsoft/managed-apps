# SharePoint lists backend

## Provision

For each collection, create a list (for example `LearningHub_sessions`):

| Column | SharePoint type | Settings |
|---|---|---|
| `RecordKey` | Single line of text | Required, **Enforce unique values: Yes** (this also indexes it) |
| `Data` | Multiple lines of text | **Plain text** (not rich/enhanced), "Append changes" **off** |

Rename or hide the built-in `Title` column if you like; the app does not use it. You can set
`Title` to a human-readable value (e.g. the record's name) in `createRow` to make the list browsable.

Permissions: break inheritance on each list only if it needs different access than the site.
Grant **Contribute** to people who write and **Read** to people who only read.

## Add the connector

```bash
npx ms app add data-source --connector shared_sharepointonline --as table --dataset "https://<tenant>.sharepoint.com/sites/<site>" --table "LearningHub_sessions"
```

Repeat for each list. Then inspect the generated services:

```bash
rg "async \w+\(" generated/services
```

Typical operations are "get items" (with `$filter`, `$top` and a continuation/skip token),
"get item", "create item", "update item" and "delete item". Exact names depend on the CLI version,
so use what the grep shows.

## Mapping to `BackendRow`

| BackendRow | SharePoint item |
|---|---|
| `key` | `RecordKey` |
| `data` | `Data` |
| `etag` | `@odata.etag` (or `ETag`) from the item |
| `createdAt` / `updatedAt` | `Created` / `Modified` |

- **Lookups by key**: SharePoint item ids are numeric and differ from `RecordKey`. Find items with
  a filter such as `$filter=RecordKey eq '<key>'` (escape single quotes by doubling them). Cache
  `RecordKey → item id` inside the wrapper if you want fewer calls.
- **Paging**: follow the continuation value the "get items" operation returns (`@odata.nextLink`
  or a skip token). Return it as `nextCursor`.
- **Conflicts**: if the update/delete operation accepts an `If-Match` header or etag parameter, pass
  the etag and map HTTP 412 to `ConflictError`. If it does not, re-read the item, compare `etag`,
  then write. Document in the README that a small race window remains.
- **Create uniqueness**: with "Enforce unique values" on, a duplicate `RecordKey` fails. Map that
  failure to `ConflictError`.
- **Size**: keep each record well under a few hundred KB. Large attachments belong in a document
  library, with only a link stored in the record.

## Throttling

SharePoint throttles bursts. Keep `list` page sizes moderate (100–500). If the connector reports
HTTP 429, wait for `Retry-After` and retry.
