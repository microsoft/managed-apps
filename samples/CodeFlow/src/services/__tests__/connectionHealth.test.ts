import { describe, it, expect, beforeEach } from 'vitest';
import {
  FAULT_COOLDOWN_MS,
  classifyConnectionFault,
  clearConnectionFault,
  getConnectionFault,
  isCircuitOpen,
  noteConnectionFault,
  GitHubApiError,
} from '../connectionHealth';

beforeEach(() => {
  clearConnectionFault();
});

describe('classifyConnectionFault', () => {
  it('reads a missing credential from GitHub\u2019s 401 wording', () => {
    expect(
      classifyConnectionFault(new Error('Must authenticate to access this API.')),
    ).toBe('unauthenticated');
  });

  it('treats a rejected credential the same way, since the fix is identical', () => {
    expect(classifyConnectionFault(new Error('Bad credentials'))).toBe('unauthenticated');
  });

  it('reads an IP-keyed rate limit as anonymous, not as throttling', () => {
    // This is the whole diagnosis in one assertion: GitHub only keys a limit to
    // an IP when no credential arrived, so the reviewer is not being throttled,
    // they are unauthenticated and sharing the gateway's anonymous pool.
    expect(
      classifyConnectionFault(new Error('API rate limit exceeded for 20.83.220.230.')),
    ).toBe('unauthenticated');
  });

  it('reads a user-keyed rate limit as genuine throttling', () => {
    expect(
      classifyConnectionFault(new Error('API rate limit exceeded for user ID 12345.')),
    ).toBe('rate-limited');
  });

  it('still classifies when the message is wrapped in call context', () => {
    expect(
      classifyConnectionFault(
        new Error('Failed to search pull requests: API rate limit exceeded for 20.83.220.230.'),
      ),
    ).toBe('unauthenticated');
  });

  it('reads the message out of a raw connector error object', () => {
    expect(
      classifyConnectionFault({ message: 'Must authenticate to access this API.', status: 401 }),
    ).toBe('unauthenticated');
  });

  it('leaves unrelated failures alone', () => {
    expect(classifyConnectionFault(new Error('Network request failed'))).toBeUndefined();
    expect(classifyConnectionFault(new Error('Not Found'))).toBeUndefined();
    expect(classifyConnectionFault(undefined)).toBeUndefined();
  });
});

describe('fault tracking', () => {
  it('remembers a fault it recognises', () => {
    noteConnectionFault(new Error('Bad credentials'), 1_000);

    expect(getConnectionFault(1_000)?.kind).toBe('unauthenticated');
  });

  it('ignores an error it does not recognise', () => {
    expect(noteConnectionFault(new Error('Network request failed'))).toBeUndefined();
    expect(getConnectionFault()).toBeUndefined();
  });

  it('forgets the fault once the cooldown elapses', () => {
    noteConnectionFault(new Error('Bad credentials'), 1_000);

    expect(getConnectionFault(1_000 + FAULT_COOLDOWN_MS)).toBeUndefined();
  });

  it('can be cleared explicitly, so a manual retry is never blocked', () => {
    noteConnectionFault(new Error('Bad credentials'), 1_000);
    clearConnectionFault();

    expect(getConnectionFault(1_000)).toBeUndefined();
  });
});

describe('isCircuitOpen', () => {
  it('opens for an unauthenticated connection, which retrying cannot fix', () => {
    noteConnectionFault(new Error('Must authenticate to access this API.'), 1_000);

    expect(isCircuitOpen(1_000)).toBe(true);
  });

  it('stays closed for a plain rate limit, which resolves on its own', () => {
    noteConnectionFault(new Error('API rate limit exceeded for user ID 12345.'), 1_000);

    expect(isCircuitOpen(1_000)).toBe(false);
  });

  it('closes again once the cooldown expires', () => {
    noteConnectionFault(new Error('Bad credentials'), 1_000);

    expect(isCircuitOpen(1_000 + FAULT_COOLDOWN_MS)).toBe(false);
  });
});

describe('GitHubApiError', () => {
  it('carries the status through so callers need not parse prose', () => {
    const err = new GitHubApiError('Must authenticate to access this API.', 401);

    expect(err.status).toBe(401);
    expect(err).toBeInstanceOf(Error);
    expect(classifyConnectionFault(err)).toBe('unauthenticated');
  });
});
