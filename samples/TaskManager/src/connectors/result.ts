/**
 * Shapes shared by every connector adapter. Adapters translate the generated
 * connector clients into these app-owned types so the rest of the app (and its
 * tests) never depends on `generated/`.
 */
export interface ConnectorResult<T> {
  success: boolean;
  data?: T;
  error?: unknown;
}

/** Turns whatever a connector reported as an error into an Error with a readable message. */
export function connectorError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error);
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}
