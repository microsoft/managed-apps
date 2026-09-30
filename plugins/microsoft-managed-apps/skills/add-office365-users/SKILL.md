---
name: add-office365-users
description: Adds Office 365 Users by delegating to `/add-data-source` with `api-id=shared_office365users` and action mode. Use for user profiles, managers, direct reports, people search, and profile photos.
user-invocable: true
allowed-tools: Read, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Office 365 Users (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_office365users`
- `mode`: `action`

---

# Office 365 Users: Method Selection Guide

After the connector is added, import the generated service:

```typescript
import { Office365UsersService } from '../../generated/services/Office365UsersService'
```

Use the V2 methods for profiles and reporting relationships:

| Scenario | Method | Result |
| --- | --- | --- |
| Current signed-in user | `MyProfile_V2($select?)` | One `GraphUser_V1` |
| Specific user by ID or UPN | `UserProfile_V2(id, $select?)` | One `GraphUser_V1` |
| User's manager | `Manager_V2(id, $select?)` | One `GraphUser_V1` |
| Direct reports | `DirectReports_V2(id, $select?, $top?)` | Profiles in `result.data.value` |
| Search people | `SearchUserV2(searchTerm, top?, ...)` | Search response in `result.data.value` |
| Profile photo | `UserPhotoMetadata(userId)`, then `UserPhoto_V2(id)` | Metadata, then binary image data |

`DirectReports_V2` requires the target manager's Microsoft Entra directory ID or user
principal name (UPN). For the signed-in user, call
`MyProfile_V2('id,userPrincipalName')`, then pass the returned `id` or fall back to
`userPrincipalName`. For a known person, pass their directory ID or UPN directly.

## Profile and direct-report pattern

Request only the fields the UI needs:

```typescript
const fields = [
  'id',
  'displayName',
  'jobTitle',
  'department',
  'mail',
  'userPrincipalName',
  'officeLocation',
].join(',')

const myProfile = await Office365UsersService.MyProfile_V2(
  'id,userPrincipalName',
)
if (!myProfile.success) {
  throw new Error(myProfile.error?.message ?? 'Failed to resolve current user')
}

const managerId =
  myProfile.data?.id ?? myProfile.data?.userPrincipalName

if (!managerId) {
  throw new Error('Current user profile did not include an ID or UPN')
}

const result = await Office365UsersService.DirectReports_V2(
  managerId,
  fields,
)

if (!result.success) {
  throw new Error(result.error?.message ?? 'Failed to load direct reports')
}

const people = result.data?.value ?? []
```

An empty `value` array is valid and means the user has no direct reports.

## Profile photos: binary response and CSP-safe rendering

Call `UserPhotoMetadata` before downloading the photo. `HasPhoto: false` is a valid
no-photo state; render initials or another accessible fallback.

Image responses are a special runtime contract: the generated `UserPhoto_V2` signature may
declare `IOperationResult<string>`, but the Managed Apps SDK decodes an `image/*` response into
a `Uint8Array`. Do not interpolate that byte array directly into a base64 URL, and do not use a
`blob:` URL—the deployed App Player content security policy may block `blob:` under `img-src`.

Convert the bytes to a `data:` URL:

```typescript
function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    )
  }

  return btoa(binary)
}

function toImageDataUrl(value: unknown, contentType = 'image/jpeg') {
  if (value instanceof Uint8Array) {
    return `data:${contentType};base64,${bytesToBase64(value)}`
  }

  if (value instanceof ArrayBuffer) {
    return `data:${contentType};base64,${bytesToBase64(new Uint8Array(value))}`
  }

  if (typeof value === 'string') {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
      return value
    }

    if (/^https?:/i.test(value)) {
      throw new Error(
        'Profile photo returned an HTTP URL instead of binary image data.',
      )
    }

    return `data:${contentType};base64,${value}`
  }

  throw new Error('The profile photo response used an unsupported format.')
}
```

`UserPhoto_V2` has a binary response contract and does not return an external image URL.
An HTTP value indicates an unexpected response shape, so the helper rejects it rather than
passing a potentially CSP-blocked or authenticated URL to `<img src>`.

Complete photo flow:

```typescript
const metadata = await Office365UsersService.UserPhotoMetadata(userId)
if (!metadata.success) {
  throw new Error(metadata.error?.message ?? 'Failed to check profile photo')
}

if (!metadata.data?.HasPhoto) {
  return undefined
}

const photo = await Office365UsersService.UserPhoto_V2(userId)
if (!photo.success) {
  throw new Error(photo.error?.message ?? 'Failed to load profile photo')
}

return photo.data
  ? toImageDataUrl(photo.data, metadata.data.ContentType)
  : undefined
```

Always fetch photos through the generated connector service. Do not call Microsoft Graph
directly and do not assign the authenticated connector runtime URL to `<img src>`.
