---
name: add-office365
description: Adds Office 365 Outlook by delegating to `/add-data-source` with `api-id=shared_office365` and action mode. Use when integrating Outlook mail/calendar.
user-invocable: true
allowed-tools: Read, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Office 365 Outlook (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_office365`
- `mode`: `action`

---

# Office 365 Connector: Method Selection Guide

After the connector is added, you'll have access to `Office365OutlookService` with 20+ methods. **Use this guide to select the right method for your use case.**

## Calendar Operations

### For Fetching Events in a Date Range: `GetEventsCalendarViewV2`

**Best for:** Meeting lists, calendar views, event queries between two dates (e.g., "past 7 days", "next 30 days").

**Key Parameters:**
- `calendarId` (string) — Always discover using `CalendarGetTables()` first
- `startDateTimeOffset` (ISO 8601 string) — Use `.toISOString()`
- `endDateTimeOffset` (ISO 8601 string) — Use `.toISOString()`
- `top`, `skip` (optional) — For pagination (200-1000 range typical)

**Pattern:**

```typescript
import { Office365OutlookService } from '../../generated/services/Office365OutlookService'

// Step 1: Discover calendar ID (validate and prefer primary calendar)
const calendarsResult = await Office365OutlookService.CalendarGetTables()
if (!calendarsResult.success) {
  throw new Error(calendarsResult.error?.message ?? 'Failed to list calendars')
}

const calendars = calendarsResult.data?.value ?? []
if (calendars.length === 0) {
  throw new Error('No calendars found in Office 365 connection')
}

// Prefer primary 'calendar' (by DisplayName), fall back to first
const defaultCalendar =
  calendars.find((c: any) => (c.DisplayName ?? '').toLowerCase() === 'calendar') 
  ?? calendars[0]
const calendarId = defaultCalendar?.Name ?? calendars[0]?.Name

if (!calendarId) {
  throw new Error('Could not determine calendar ID from response')
}

// Step 2: Query events with pagination
const eventsResult = await Office365OutlookService.GetEventsCalendarViewV2(
  calendarId,
  startDate.toISOString(),
  endDate.toISOString(),
  undefined,        // filter (optional)
  undefined,        // select (optional)
  200,              // top - results per page
  0                 // skip - pagination offset
)

if (!eventsResult.success) {
  throw new Error(eventsResult.error?.message ?? 'Failed to fetch events')
}

const meetings = eventsResult.data?.value ?? []
```

**Response Structure:**
- Array of `CalendarEventClientReceiveStringEnums` (access via `.data.value`)
- Contains: `Subject`, `Start`, `End`, `Id`, `Organizer`, `RequiredAttendees`, `OptionalAttendees`

### For Immediate Upcoming Events: `OnUpcomingEventsV3`

**Best for:** "Show me my next meeting" queries using a minutes-based time window.

**Key Parameters:**
- `table` (string) — Calendar ID
- `minutesWindow` (number) — Time window in minutes (e.g., 60 for next hour, 1440 for next 24 hours)

### For Creating Events: `V3CalendarPostItem`

**Parameters:**
- `table` — Calendar ID
- `item` — `CalendarEventHtmlClient` object with `Subject`, `Start`, `End` (required)

### For Updating Events: `CalendarPatchItem`

**Parameters:**
- `table` — Calendar ID
- `id` — Event ID
- `item` — Updated event properties

### For Deleting Events: `CalendarDeleteItem`

**Parameters:**
- `table` — Calendar ID
- `id` — Event ID

### Discovery: `CalendarGetTables`

**Purpose:** List available calendars to discover correct calendar IDs (required before using other calendar methods)

## Email Operations

### For Sending Emails: `SendEmailV2`

**Best for:** Sending notifications, alerts, summaries.

**Pattern:**

```typescript
const result = await Office365OutlookService.SendEmailV2({
  To: 'recipient@example.com',
  Subject: 'Meeting Summary',
  Body: '<p>Here is your meeting summary...</p>',
  Importance: 'Normal'
})
```

### For Fetching Inbox: `GetEmails`

**Parameters:**
- `folderPath` (string) — E.g., "Inbox", "Drafts"
- `fetchOnlyUnread` (boolean) — Filter for unread emails
- `top` (number) — Limit

### For Reading Single Email: `GetEmail`

**Parameters:**
- `messageId` (string) — Email ID

### For Marking as Read: `MarkAsRead`

**Parameters:**
- `messageId` (string) — Email ID

### For Replying to Email: `ReplyToV3`

**Parameters:**
- `messageId` (string) — Email ID to reply to
- `body` (string) — Reply text

---

## Key Patterns

**📋 Generic connector response handling:** [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md#connector-response-handling) — Error handling, array access (`.data.value`), empty results, and response structure patterns apply to all connectors, including Office 365.

**1. Always discover calendar ID first using `CalendarGetTables()`**

This ensures you have the correct calendar ID for the user (don't hardcode "Calendar").

**2. Use ISO date strings for date parameters**

Use `.toISOString()` when passing dates to Office 365 methods.

**3. Calendar ID Discovery - CRITICAL**

**⚠️ NEVER use hardcoded `'Calendar'` as calendar ID.** Always discover from the user's actual calendars.

```typescript
// ❌ BROKEN - Will fail for users whose primary calendar isn't named 'Calendar'
const calendarId = 'Calendar'

// ✅ CORRECT - Discover actual calendar IDs
const calendarsResult = await Office365OutlookService.CalendarGetTables()
const calendars = calendarsResult.data?.value ?? []

// Validate calendars exist
if (calendars.length === 0) {
  throw new Error('No calendars found')
}

// Prefer primary calendar by DisplayName, otherwise use first
const primaryCalendar =
  calendars.find((c: any) => (c.DisplayName ?? '').toLowerCase() === 'calendar')
  ?? calendars[0]

// Extract the actual calendar ID from response
const calendarId = primaryCalendar?.Name

if (!calendarId) {
  throw new Error('Could not extract calendar ID from Office 365 response')
}
```

**Why this matters:**
- Users may have multiple calendars (shared calendars, project calendars, etc.)
- The primary calendar's internal ID is not always the string `"Calendar"`
- Hardcoding causes failures for any user without a calendar literally named `"Calendar"`
- Must validate response contains valid data before proceeding
