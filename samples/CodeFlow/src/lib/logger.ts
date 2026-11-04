/**
 * Tiny diagnostic logger.
 *
 * - Silent in production builds: nothing reaches the console of a deployed app.
 * - Never logs payloads, identities or connector responses. Callers pass a short
 *   event name and, at most, the error that caused it; only the error's name and
 *   message are printed.
 */

export interface Logger {
  info(event: string): void;
  warn(event: string, error?: unknown): void;
  error(event: string, error?: unknown): void;
}

const enabled = !import.meta.env.PROD;

function describe(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : 'non-Error value';
}

const noop: Logger = { info() {}, warn() {}, error() {} };

export function createLogger(scope: string): Logger {
  if (!enabled) return noop;
  const prefix = `[codeflow:${scope}]`;
  return {
    info(event) {
      console.info(`${prefix} ${event}`);
    },
    warn(event, error) {
      const reason = describe(error);
      if (reason) console.warn(`${prefix} ${event}`, reason);
      else console.warn(`${prefix} ${event}`);
    },
    error(event, error) {
      const reason = describe(error);
      if (reason) console.error(`${prefix} ${event}`, reason);
      else console.error(`${prefix} ${event}`);
    },
  };
}
