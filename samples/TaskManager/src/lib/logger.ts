/**
 * Tiny development logger. Every method is a no-op in production builds, and
 * callers must pass only short, static context — never payloads, identities,
 * connector responses or user content.
 */
type Level = "debug" | "info" | "warn" | "error";

const enabled = import.meta.env.DEV && import.meta.env.MODE !== "test";

function write(level: Level, scope: string, message: string, error?: unknown): void {
  if (!enabled) return;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : undefined;
  const line = `[${scope}] ${message}`;
  if (detail) console[level](line, detail);
  else console[level](line);
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message) => write("debug", scope, message),
    info: (message) => write("info", scope, message),
    warn: (message, error) => write("warn", scope, message, error),
    error: (message, error) => write("error", scope, message, error),
  };
}

export const logger = createLogger("app");
