---
name: add-workiq
description: Adds Work IQ Copilot MCP by delegating to /add-data-source with api-id=shared_a365copilotchatmcp and action mode. Use when users need Microsoft 365 knowledge-grounded Work IQ search/chat.
user-invocable: true
allowed-tools: Read, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${CLAUDE_PLUGIN_ROOT}/shared/shared-instructions.md)** — Cross-cutting concerns.

# Add Work IQ Copilot MCP (Wrapper)

This skill is a thin wrapper. Use `/add-data-source` as the single implementation path.

## Delegation contract

Invoke `/add-data-source` with:

- `api-id`: `shared_a365copilotchatmcp`
- `mode`: `action`

---

# Work IQ Integration: MCP Session Pattern

After the connector is added, you'll have access to `WorkIQCopilotMCPService`. **Work IQ uses MCP (Model Context Protocol), a stateful protocol. Use the `McpSession` wrapper class to manage this properly.**

## Setup: Create McpSession Wrapper

⚠️ **CRITICAL:** The McpSession implementation is complex. Copy the production-ready code below exactly. It handles session negotiation, auto-retry on errors, proper JSON-RPC ID sequencing, and response parsing.

Create `src/connectors/mcpClient.ts`:

```typescript
import type { IOperationResult } from '@microsoft/managed-apps/data'
import { WorkIQCopilotMCPService } from '../../generated/services/WorkIQCopilotMCPService'
import type { QueryRequest } from '../../generated/models/WorkIQCopilotMCPModel'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc?: string
  id?: string
  result?: Record<string, unknown>
  error?: { code?: number; message?: string; data?: unknown }
}

type CopilotConversationMessage = {
  text?: string
  attributions?: Array<{ attributionType?: string; providerDisplayName?: string; seeMoreWebUrl?: string }>
}

type CopilotConversation = {
  messages?: CopilotConversationMessage[]
}

function parseRpc(result: IOperationResult<unknown>): JsonRpcResponse {
  if (!result.success && result.error) {
    return { error: { message: result.error.message } }
  }

  const data: unknown = result.data
  if (data == null) return {}
  if (typeof data === 'object') return data as JsonRpcResponse
  if (typeof data === 'string') {
    const dataLines = data
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    const payload = dataLines.length ? dataLines.join('') : data
    try {
      return JSON.parse(payload) as JsonRpcResponse
    } catch {
      return { result: { raw: data } }
    }
  }

  return { result: { raw: data } }
}

export class McpSession {
  private nextId = 1
  private sessionId: string | undefined
  private conversationId: string | undefined
  private initialized = false

  private extractSessionId(raw: IOperationResult<unknown>): string | undefined {
    const container = raw as unknown as Record<string, unknown>
    const dataObj =
      raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : undefined
    const resultObj =
      dataObj?.result && typeof dataObj.result === 'object'
        ? (dataObj.result as Record<string, unknown>)
        : undefined

    const candidates: Array<unknown> = [
      dataObj?.['Mcp-Session-Id'],
      dataObj?.mcpSessionId,
      dataObj?.sessionId,
      resultObj?.['Mcp-Session-Id'],
      resultObj?.mcpSessionId,
      resultObj?.sessionId,
      container['Mcp-Session-Id'],
      container.mcpSessionId,
      container.sessionId,
    ]

    const found = candidates.find((value) => typeof value === 'string' && value.length > 0)
    return typeof found === 'string' ? found : undefined
  }

  private isSessionNotFound(res: JsonRpcResponse): boolean {
    const message = (res.error?.message ?? '').toLowerCase()
    return message.includes('session not found') || res.error?.code === -32001
  }

  private resetSession(): void {
    this.sessionId = undefined
    this.initialized = false
  }

  private async send(
    method: string,
    params?: Record<string, unknown>,
    allowRetry = true
  ): Promise<JsonRpcResponse> {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: String(this.nextId++), method, params }
    const raw = (await WorkIQCopilotMCPService.mcp_m365copilot(
      this.sessionId,
      req as QueryRequest
    )) as unknown as IOperationResult<unknown>

    const negotiatedSessionId = this.extractSessionId(raw)
    if (negotiatedSessionId) {
      this.sessionId = negotiatedSessionId
    }

    const parsed = parseRpc(raw)

    if (allowRetry && method !== 'initialize' && this.isSessionNotFound(parsed)) {
      this.resetSession()
      await this.initialize()
      return this.send(method, params, false)
    }

    return parsed
  }

  async initialize(): Promise<JsonRpcResponse> {
    const res = await this.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'Custom App', version: '1.0.0' },
    })
    this.initialized = !res.error
    return res
  }

  async callCopilotChat(message: string): Promise<{ text: string; conversationId?: string }> {
    if (!this.initialized) await this.initialize()
    const raw = await this.send('tools/call', {
      name: 'CopilotChat',
      arguments: {
        message,
        ...(this.conversationId ? { conversationId: this.conversationId } : {}),
      },
    })

    const parsed = extractCopilotText(raw)
    if (parsed.conversationId) {
      this.conversationId = parsed.conversationId
    }

    return { text: parsed.text, conversationId: parsed.conversationId }
  }
}

function extractContentText(res: JsonRpcResponse): string | undefined {
  const content = res.result?.content as Array<{ type?: string; text?: string }> | undefined
  if (!Array.isArray(content)) {
    return undefined
  }

  const textBlocks = content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!.trim())
    .filter((value) => value.length > 0)

  if (textBlocks.length === 0) {
    return undefined
  }

  // Prefer the JSON payload block. Some responses append metadata text blocks
  // such as "CorrelationId: ..." that should not be concatenated.
  const jsonBlock = textBlocks.find(
    (block) => block.startsWith('{') && /"conversationId"|"rawResponse"|"reply"/.test(block)
  )
  if (jsonBlock) {
    return jsonBlock
  }

  const nonMetadata = textBlocks.find((block) => !/^CorrelationId\s*:/i.test(block))
  return nonMetadata ?? textBlocks[0]
}

export function extractCopilotText(res: JsonRpcResponse): { text: string; conversationId?: string } {
  if (res.error) {
    return { text: `Error: ${res.error.message ?? JSON.stringify(res.error)}` }
  }

  const rawText = extractContentText(res)
  if (!rawText) {
    return { text: res.result ? JSON.stringify(res.result, null, 2) : '(no content returned)' }
  }

  try {
    const inner = JSON.parse(rawText) as {
      conversationId?: string
      reply?: string
      message?: string
      rawResponse?: string
    }

    if (typeof inner.rawResponse === 'string') {
      try {
        const convo = JSON.parse(inner.rawResponse) as CopilotConversation
        const messages = Array.isArray(convo.messages) ? convo.messages : []
        const attributed = messages.find(
          (m) => Array.isArray(m.attributions) && m.attributions.length > 0
        )
        const selected = attributed ?? messages[1] ?? messages[messages.length - 1]
        const replyText = selected?.text?.trim()
        if (replyText) {
          return { text: replyText, conversationId: inner.conversationId }
        }
      } catch {
        // Fall through to simple reply extraction.
      }
    }

    const fallbackText = inner.reply?.trim() || inner.message?.trim() || rawText
    return { text: fallbackText, conversationId: inner.conversationId }
  } catch {
    return { text: rawText }
  }
}
```

## Usage: Generic Work IQ Integration Pattern

Initialize **once per app** (typically on component mount or app boot) and reuse for all Work IQ calls:

```typescript
import { McpSession } from './connectors/mcpClient'

// Initialize once per app session (e.g., in React useEffect on app boot)
const workIqSession = new McpSession()

// Call with any knowledge-grounded prompt
export async function queryWorkIQ(userPrompt: string): Promise<string> {
  try {
    const { text } = await workIqSession.callCopilotChat(userPrompt)
    return text
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Work IQ query failed'
    console.error('Work IQ Error:', msg)
    throw error
  }
}
```

**Key Patterns:**
- ✅ Initialize once, reuse across multiple calls
- ✅ Pass context-specific prompts to `callCopilotChat()`
- ✅ Adapt prompts for your specific scenario (meetings, priorities, analysis, etc.)
- ✅ Session automatically reinitializes if "Session not found" error occurs
- ✅ Conversation ID is automatically persisted across calls for multi-turn chats

## Prompt Structure

Work IQ responds well to **context-rich, structured prompts**. Use this pattern and adapt it for your specific scenario:

```typescript
// Generic pattern to adapt for your use case:
const prompt = `
You are [role/expert description].

**Context:**
- [Relevant data or background information]
- [Additional context as needed]

**Task:** [Clear, specific instruction]

**Format:** [If you need structured output, specify the format]
- Use markdown with clear section headings (## Section, ## Action Items, etc.)
- Specify limits (word count, number of items, etc.)
`.trim()

const { text } = await workIqSession.callCopilotChat(prompt)
```

**How to adapt this pattern:**
- ✅ Customize the role and context for your scenario (e.g., "meeting summarizer", "action item prioritizer", "project analyst")
- ✅ Add domain-specific information from your app
- ✅ Define the exact format you need (structured markdown, JSON, bullets, etc.)
- ✅ Adjust word limits and output expectations for your use case

**Examples of adaptable scenarios:**
- Meeting summaries with action items
- Prioritized daily action items from emails
- Project risk analysis from documents
- Team performance insights from communications
- Or any other knowledge-grounded analysis task

## Response Parsing

Work IQ returns text that you parse based on your use case.

**For structured markdown output** (when you asked for ## sections):

```typescript
const { text } = await workIqSession.callCopilotChat(prompt)

// Extract markdown sections
function extractSection(text: string, sectionName: string): string[] {
  const regex = new RegExp(`##\\s*${sectionName}\\s*([\\s\\S]*?)(?=##|$)`)
  const match = text.match(regex)
  if (!match) return []
  
  return match[1]
    .split('\n')
    .filter(line => line.trim().startsWith('-'))
    .map(line => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}

const summary = extractSection(text, 'Summary')
const actionItems = extractSection(text, 'Action Items')
```

**For unstructured output** (when format is not critical):

```typescript
const { text } = await workIqSession.callCopilotChat(prompt)
// Use text directly - display as-is or format as needed for your UI
```

**Adjust parsing based on:**
- ✅ The format you specified in the prompt
- ✅ Your response structure (markdown sections, JSON, numbered lists, etc.)
- ✅ Both structured (markdown, JSON) and unstructured (text) outputs

## Error Handling & Auto-Recovery

McpSession automatically handles "Session not found" errors by reinitializing. Surface errors appropriately:

```typescript
try {
  const { text } = await workIqSession.callCopilotChat(prompt)
  
  if (text.includes('Error:')) {
    throw new Error(text)
  }
  
  return text
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : 'Query failed'
  console.error('Work IQ Error:', errorMsg)
  throw error
}
```

**What McpSession handles automatically:**
- ✅ Detects "Session not found" (-32001) errors
- ✅ Closes the session and auto-reinitializes
- ✅ Retries the failed request with the new session
- ✅ No manual retry logic needed

**You only need to:**
- ✅ Wrap calls in try/catch
- ✅ Surface errors to users appropriately
- ✅ Let exceptions propagate for app-level error handling

---

## Implementation Guidance

**Step 1: Copy mcpClient.ts**
Use the provided McpSession implementation as-is. It handles all MCP protocol complexity.

**Step 2: Initialize once**
Create the McpSession instance once per app session (in useEffect or on boot).

**Step 3: Craft your prompts**
For your specific use case, provide context-rich prompts that include:
- Your domain context (meetings, priorities, risks, etc.)
- Specific data from your app
- Expected output format

**Step 4: Parse and display**
Extract the relevant data from Work IQ's response based on the format you requested.

---

## Common Use Cases

**Meeting Summaries:**
- Prompt Work IQ with meeting context (date, organizer, attendees, description)
- Request ## Summary and ## Action Items sections
- Parse markdown sections and display in modal

**Prioritized Daily Action Items:**
- Query Work IQ to extract high-priority tasks from emails/messages
- Request ranked list format with due dates and owners
- Parse and display as prioritized task list

**Project Risk Analysis:**
- Prompt Work IQ to analyze project communications
- Request structured risk assessment with mitigation recommendations
- Parse JSON and display risk dashboard

**Team Performance Insights:**
- Query collaboration patterns from Teams/emails
- Request insights on productivity and blockers
- Parse and display performance dashboard

**Any Knowledge-Grounded Analysis:**
- Adapt the pattern for your domain
- Use Work IQ's access to M365 data (emails, Teams, calendar, documents)
- Return structured or unstructured output as needed

## Why This Pattern is Required

**Work IQ uses MCP (Model Context Protocol)**, a stateful protocol that requires:
1. **Session initialization** before first call (handshake to exchange capabilities)
2. **Session ID tracking** across all requests
3. **Proper JSON-RPC ID sequencing** (each request must have a unique numeric ID)
4. **Multi-turn conversation support** with conversation ID persistence
5. **Complex response parsing** (nested JSON-RPC + optional streaming)
6. **Automatic error recovery** on session timeouts

The `McpSession` class handles all of this. Attempting to bypass it (using random session IDs, hardcoded IDs, or direct API calls) will result in "Session not found" errors and failed integrations.
