# Connector Decision Guide

**Use this guide to select the right connector(s) for user scenarios.** This ensures consistent, intelligent connector recommendations across all `/add-*` skills.

> **Note:** This guide covers the most common connectors. There are **1400+ connectors** available across the Microsoft ecosystem (Power Platform, Copilot Studio, Power Automate, Power Apps, Azure Logic Apps). See [Discovering All Available Connectors](#discovering-all-available-connectors) below.

---

## Discovering All Available Connectors

The Microsoft connector catalog has **1400+ connectors**. This guide shows the most common ones, but you can discover others:

### **Via CLI**

```bash
# Search for a specific connector (e.g., Salesforce, SAP, Slack)
ms connector list --search "salesforce"

# List operations available on a connector
ms connector list-actions --connector <api-id>
ms connector list-actions --connector shared_office365 --search Mail
```

### **Via Plugin Skills**

- **`/add-connector`** — Generic connector skill. Ask for a keyword ("salesforce", "slack", "jira", "workiq") and it will search, present options, and add the connector.
- **`/list-connections`** — View connectors already bound to your app, or explore operations on a specific connector

### **Via Specific Skills**

For common connectors, shortcuts exist:
- **`/add-office365`** — Office 365 Outlook (calendar, email)
- **`/add-teams`** — Teams messages
- **`/add-sharepoint`** — SharePoint lists/documents
- **`/add-dataverse`** — Dataverse tables
- **`/add-mcscopilot`** — Copilot Studio agents
- **`/add-workiq`** — Work IQ Copilot MCP (M365 knowledge-grounded search/chat)
- (See full list in `/add-connector` help)

### **Via Microsoft Docs**

Search the [Microsoft connectors documentation](https://learn.microsoft.com/en-us/connectors/) for:
- Specific services you want to integrate (Salesforce, SAP, Slack, etc.)
- Connector capabilities and available operations
- API documentation and authentication details

These connectors are shared across Power Platform, Copilot Studio, Power Automate, Power Apps, and Azure Logic Apps.

---

## Connector Reference

**See `agents/microsoft-apps-architect.md` for the current connector capability matrix** (single source of truth to avoid duplication).

The matrix shows which connectors can search, create/update, delete, and provide AI capabilities.

---

## Decision Trees by User Scenario

### **Scenario 1: User wants to SEARCH or FIND data**

```
Does the app need to search across M365 (email, files, calendar, contacts)?
  ├─ YES, semantic/conversational search → Use Work IQ (`/add-workiq`)
  │   Example: "Find all meetings with client XYZ"
  │   Example: "Show emails about project Alpha from last month"
  │
  └─ NO, or need specific list filtering → Use the specific connector
      Example: "List calendar events in December" → Office365
      Example: "Find all tasks assigned to me" → Azure DevOps
      Example: "Search documents with keyword" → SharePoint
```

**Rule:** Always prefer Work IQ for semantic, cross-M365 search. Use specific connectors only when you need precise filtering on a single service.

---

### **Scenario 2: User wants to CREATE/UPDATE/DELETE data**

```
What type of data?
  ├─ Calendar events, emails, inbox → Office 365 Outlook (`/add-office365`)
  ├─ Teams messages, channels → Teams (`/add-teams`)
  ├─ SharePoint lists, documents → SharePoint (`/add-sharepoint`)
  ├─ Files (upload, download, version) → OneDrive (`/add-onedrive`)
  ├─ Excel worksheets → Excel Online (`/add-excel`)
  ├─ Work items, bugs, builds → Azure DevOps (`/add-azuredevops`)
  ├─ Custom business data (structured) → Dataverse (`/add-dataverse`)
  ├─ Database stored procedures → SQL Procedures (`/add-procedure`)
  └─ Invoke a pre-built AI agent → Copilot Studio (`/add-mcscopilot`)
```

**Rule:** Each connector maps directly to one service. Pick based on where the data lives.

---

### **Scenario 3: User wants to ADD AI/INTELLIGENCE**

```
What kind of AI capability?
  ├─ Summarization, content generation → Copilot Studio (`/add-mcscopilot`)
  │   Example: "Summarize this meeting transcript"
  │   Example: "Generate action items from notes"
  │
  ├─ Semantic search, Q&A with citations → Work IQ (`/add-workiq`)
  │   Example: "What was decided about budget in past meetings?"
  │   Example: "Show me all discussions about Q3 planning"
  │
  └─ Rule-based logic or no AI needed → Use standard connector + custom logic
      Example: "Filter calendar events by duration" → Office365 + client-side filter
```

**Rule:** Work IQ is search-focused AI. Copilot Studio is for agents and summarization.

---

### **Scenario 4: Hybrid apps (SEARCH + ACTION)**

```
Example: "Meeting Insights" app
  ├─ List past meetings (action) → Office365 (`/add-office365`)
  ├─ Fetch transcript/recording details (action) → Teams (`/add-teams`)
  ├─ Allow "find meetings about topic X" (search) → Work IQ (`/add-workiq`)
  └─ Generate summary (AI) → Copilot Studio (`/add-mcscopilot`)

→ Invoke `/add-office365`, `/add-teams`, `/add-workiq`, `/add-mcscopilot` in sequence
```

**Rule:** When multiple connectors are needed, each handles one responsibility. Invoke in order of dependency (actions first, then searches/AI).

---

## When NOT to Use a Connector

### **❌ Don't use Work IQ for:**
- ✗ Creating or updating M365 data ("I want to send an email")
- ✗ Deleting data
- ✗ Precise filtering with specific parameters
- ✗ Structured CRUD operations

**Instead:** Use the specific connector (Office365, Teams, SharePoint, etc.)

### **❌ Don't use Office 365 for:**
- ✗ Semantic search across M365
- ✗ "Find emails about topic X" (use Work IQ)
- ✗ File management (use OneDrive)
- ✗ Team collaboration (use Teams for messages)

**Instead:** Use Work IQ for search, or the specific connector for actions

### **❌ Don't use Dataverse for:**
- ✗ Temporary/session data (use React state)
- ✗ M365 search (use Work IQ)
- ✗ External service data (use the service's connector)

**Instead:** Use Dataverse only for persistent, shared business data

---

## Connector Selection Checklist

When a user describes their app, ask these questions:

1. **Is the app primarily a SEARCH interface?**
   - If YES → recommend Work IQ
   - If NO → proceed to #2

2. **Does the app need to search/query data semantically across M365?**
   - If YES → add Work IQ (in addition to specific connectors)
   - If NO → proceed to #3

3. **What service/data does the app work with?** (Pick from the matrix above)
   - Calendar → Office365
   - Messages → Teams
   - Documents → SharePoint or OneDrive
   - Lists → Dataverse or SharePoint
   - Work items → Azure DevOps
   - Spreadsheets → Excel
   - Custom data → Dataverse
   - AI generation/summarization → Copilot Studio

4. **Does the app need to CREATE, UPDATE, or DELETE data?**
   - If YES → ensure you have the right connector for write operations
   - If NO → search-only connector (Work IQ) is sufficient

5. **Does the app need AI-powered features (summarization, content generation)?**
   - If YES → add Copilot Studio (`/add-mcscopilot`)
   - If NO → proceed without it

---

## Common App Patterns

### **Pattern 1: Report/Dashboard App**
```
User Goal: "Build a dashboard showing my tasks and calendar"

Connectors Recommended:
  1. Office 365 (`/add-office365`) — fetch calendar events
  2. Azure DevOps (`/add-azuredevops`) — fetch work items
  3. Optional: Work IQ (`/add-workiq`) — allow search/drill-down
```

### **Pattern 2: Meeting Insights App**
```
User Goal: "List meetings, show transcripts, generate AI summaries"

Connectors Recommended:
  1. Office 365 (`/add-office365`) — fetch calendar + meeting metadata
  2. Teams (`/add-teams`) — fetch transcripts/recordings
  3. Copilot Studio (`/add-mcscopilot`) — generate summaries
  4. Optional: Work IQ (`/add-workiq`) — semantic meeting search
```

### **Pattern 3: Document Search & Management App**
```
User Goal: "Search company documents and allow downloads"

Connectors Recommended:
  1. Work IQ (`/add-workiq`) — semantic document search
  2. SharePoint (`/add-sharepoint`) — manage documents
  3. OneDrive (`/add-onedrive`) — if including personal files
```

### **Pattern 4: Task Tracker with Smart Suggestions**
```
User Goal: "Track tasks with AI-powered recommendations"

Connectors Recommended:
  1. Dataverse (`/add-dataverse`) — custom task data
  2. Copilot Studio (`/add-mcscopilot`) — AI suggestions
  3. Optional: Azure DevOps (`/add-azuredevops`) — for existing work items
```

### **Pattern 5: Customer Management System**
```
User Goal: "Store customer data, fetch emails, track interactions"

Connectors Recommended:
  1. Dataverse (`/add-dataverse`) — customer records
  2. Office 365 (`/add-office365`) — fetch emails by customer
  3. Optional: Work IQ (`/add-workiq`) — search customer conversations
```

---

## Implementation Guidance for Skills

### **For All Skills That Select Connectors**

When the user describes their app goal or data need:
1. Match against the scenarios above
2. Apply the decision trees
3. Recommend ONE primary connector or a SEQUENCE of connectors
4. Explain why each is chosen (reference the rules above)
5. Invoke the appropriate `/add-*` skills in order

### **For `/add-connector` (Canonical Skill)**

This skill handles ANY connector, including those not listed in this guide. When called:

1. **If a connector name is provided** (e.g., "Salesforce", "Slack"):
   - Search using `ms connector list --search "<term>"`
   - Present matching connectors to the user
   - Ask user to pick one

2. **If an `api-id` is provided** (e.g., `shared_office365`, `shared_teams`):
   - Verify with `ms connector list-actions --connector <api-id>`
   - Confirm the mode (action, table, procedure) matches intent

3. **If uncertain about availability**:
   - Check Microsoft connectors documentation: https://learn.microsoft.com/en-us/connectors/
   - Use `/list-connections` skill to browse available connectors

**This guide covers the most common cases, but `/add-connector` works with any Microsoft connector — not just the 10 listed above.**

### **For Managed apps Architect Agent**

When recommending connectors for an app design:
1. Always start with the user's end goal (not available connectors)
2. Apply the decision trees to recommend the right connector
3. If multiple options exist, explain the trade-offs
4. Include Work IQ capabilities in the recommendation if semantic M365 search is valuable
5. Flag if no connector exists and suggest alternatives

---

## Examples: Applying the Guide

### **Example 1: User says "I want to list emails from the last week"**

```
Decision Process:
  1. Is it search? → NO (specific filtering: "last week")
  2. Service? → Email (Office 365)
  3. Action needed? → READ (YES)
  4. AI needed? → NO

→ Recommend: `/add-office365`
```

### **Example 2: User says "I want to search all my files for 'budget report'"**

```
Decision Process:
  1. Is it search? → YES (semantic, cross-service)
  2. Semantic M365 search? → YES
  3. Action needed? → NO (search-only)
  4. AI needed? → NO

→ Recommend: `/add-connector` (then optionally `/add-sharepoint` if file management needed)
```

### **Example 3: User says "I need to build a system to store customer records and generate AI summaries of their interactions"**

```
Decision Process:
  1. Is it search? → NO (custom data)
  2. Service? → Multiple (custom data + AI)
  3. Actions needed? → YES (CRUD)
  4. AI needed? → YES (summaries)

→ Recommend in sequence:
   - `/add-dataverse` (store customer records)
   - `/add-mcscopilot` (generate summaries)
   - Optional: `/add-office365` (if fetching customer emails)
```

---

## When to Update This Guide

Add new scenarios when:
- A new connector is added to the platform
- Users repeatedly ask about a new app pattern
- Trade-offs between connectors change (e.g., new capabilities added)
- A scenario requires special handling not covered above

Update in `shared/connector-decision-guide.md`, and update the reference in `shared/shared-instructions.md` so all skills see the latest guidance.
