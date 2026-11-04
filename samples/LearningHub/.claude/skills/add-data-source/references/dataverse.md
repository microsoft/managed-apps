# Dataverse tables backend

## Provision

For each collection, create a table (for example display name `LearningHub Session`, logical
name `<publisherprefix>_learninghubsession`):

| Column | Dataverse type | Settings |
|---|---|---|
| `RecordKey` | Text (single line), max length 200 | Business required, plus an **alternate key** on this column |
| `Data` | Multiline text (plain) | Max length 1,048,576 |

The primary name column can hold a readable label (for example the record's title) for
browsing in Dataverse. Ownership: choose **User or team** if you need per-user security, or
**Organization** for data everyone shares.

Security: create or extend a **security role** with Create/Read/Write/Delete privileges on each
table at the right depth (User, Business Unit or Organization), and assign it to the app's users.

## Add the connector

```bash
npx ms app add data-source --connector dataverse --as table --table "<publisherprefix>_learninghubsession"
```

No connection id is needed; the CLI binds to the active environment's Dataverse. Repeat per
table, then inspect the generated services with `rg "async \w+\(" generated/services`.

## Mapping to `BackendRow`

| BackendRow | Dataverse row |
|---|---|
| `key` | `RecordKey` column (the alternate key) |
| `data` | `Data` column |
| `etag` | `@odata.etag` |
| `createdAt` / `updatedAt` | `createdon` / `modifiedon` |

- **Lookups by key**: retrieve by alternate key, or filter `RecordKey eq '<key>'`. Keep the row's
  primary GUID in the wrapper for updates and deletes.
- **Paging**: follow `@odata.nextLink`, or the paging cookie the generated list operation exposes.
- **Conflicts**: Dataverse supports optimistic concurrency. Send `If-Match: <etag>` on update
  and delete, and map HTTP 412 to `ConflictError`. A duplicate alternate key on create fails, so
  map that to `ConflictError` too.
- **Timestamps** are UTC ISO strings, so pass them through unchanged.

## Notes

- Use a **solution** to hold the tables and security role, so the setup can be exported to other environments.
- Dataverse capacity is metered. JSON in `Data` is compact, but avoid storing large blobs; use file columns or SharePoint for documents.
