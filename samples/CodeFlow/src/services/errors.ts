const MESSAGE_KEYS = ['message', 'error_description', 'error', 'detail'] as const;

/** Pull a human message out of an API error body that arrived as a JSON string. */
function unwrapJsonMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return text;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const inner = pickMessage(parsed as Record<string, unknown>);
      if (inner) return inner;
    }
  } catch {
    // Not JSON after all — keep the original text.
  }
  return text;
}

function pickMessage(record: Record<string, unknown>): string | undefined {
  for (const key of MESSAGE_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** Best-effort human-readable text for an arbitrary thrown/returned error value. */
export function describeError(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (err instanceof Error) return unwrapJsonMessage(err.message);
  if (typeof err === 'string') return err ? unwrapJsonMessage(err) : 'Unknown error';
  if (typeof err === 'object') {
    const direct = pickMessage(err as Record<string, unknown>);
    if (direct) return unwrapJsonMessage(direct);
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json;
    } catch {
      // Fall through to the generic label for circular structures.
    }
    return 'Unknown error';
  }
  return String(err);
}
