/**
 * Development-only logger. Production builds drop every call, and callers pass short messages
 * only: never record payloads, user identities, or connector responses.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const noop = () => {};

function createLogger(enabled: boolean): Logger {
  if (!enabled) return { info: noop, warn: noop, error: noop };
  return {
    info: (message) => console.info(`[app] ${message}`),
    warn: (message) => console.warn(`[app] ${message}`),
    error: (message) => console.error(`[app] ${message}`),
  };
}

export const logger: Logger = createLogger(!import.meta.env.PROD && import.meta.env.MODE !== 'test');
