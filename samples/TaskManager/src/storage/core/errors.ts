export type StorageErrorCode = 'not-found' | 'conflict' | 'validation' | 'quota' | 'unavailable';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

export class NotFoundError extends StorageError {
  constructor(collection: string, id: string) {
    super('not-found', `No record "${id}" in ${collection}.`);
    this.name = 'NotFoundError';
  }
}

/** Someone else changed (or created) the record first. Reload and retry. */
export class ConflictError extends StorageError {
  constructor(collection: string, id: string) {
    super('conflict', `Record "${id}" in ${collection} was changed by someone else.`);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends StorageError {
  readonly issues: unknown;
  constructor(collection: string, issues: unknown, message?: string) {
    super('validation', message ?? `Data for ${collection} does not match its schema.`);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class QuotaExceededError extends StorageError {
  constructor(options?: { cause?: unknown }) {
    super('quota', 'Browser storage is full. Export and remove old data, then try again.', options);
    this.name = 'QuotaExceededError';
  }
}

export class StorageUnavailableError extends StorageError {
  constructor(message = 'Storage is unavailable.', options?: { cause?: unknown }) {
    super('unavailable', message, options);
    this.name = 'StorageUnavailableError';
  }
}

export function isStorageError(error: unknown, code?: StorageErrorCode): error is StorageError {
  return error instanceof StorageError && (code === undefined || error.code === code);
}

/** A user-facing message for any storage failure. */
export function storageErrorMessage(error: unknown): string {
  if (error instanceof StorageError) return error.message;
  return 'Something went wrong while saving or loading data.';
}
