# Your own API as a backend

Use this when data must live in an existing system (an internal service, a SQL database behind an
API, a SaaS product).

## Requirements for the API

Expose, per collection (or with the collection as a path segment):

| Operation | Example | Must |
|---|---|---|
| List | `GET /collections/{name}/rows?cursor=…` | Return `{ rows: BackendRow[], nextCursor? }` and page results |
| Get | `GET /collections/{name}/rows/{key}` | Return 404 when missing |
| Create | `POST /collections/{name}/rows` with `{ key, data }` | Return 409 when the key exists |
| Update | `PUT /collections/{name}/rows/{key}` with `If-Match: <etag>` | Return 412 on a stale etag and 404 when missing |
| Delete | `DELETE /collections/{name}/rows/{key}` with optional `If-Match` | Succeed when already gone; return 412 on a stale etag |

Rows carry `key`, `data` (an opaque JSON string, stored verbatim), `etag` (changes on every
write), `createdAt` and `updatedAt`. The API must authenticate the caller and enforce
authorization itself.

## Reach it through a connector

Wrap the API in a **custom connector** (OpenAPI definition plus authentication) in your Power
Platform environment. Then add it like any other connector:

```bash
npx ms connector list --search "<your connector name>"
npx ms app add data-source --connector <api-id> --as action
```

Calling arbitrary URLs with `fetch` from the app is discouraged: it bypasses connector
authentication, data-loss-prevention policies and auditing.

## Map responses

In `src/connectors/<api>Tables.ts`, translate:

- 404 on get → `undefined`
- 409 on create → `ConflictError`
- 412 on update/delete → `ConflictError`
- 404 on update → `NotFoundError`

Then build the provider with `createTableBackedProvider()` exactly as in `SKILL.md` step 5, and
run the contract suite against a fake of the wrapper.
