import { describe, expect, it } from 'vitest';

import { describeError } from '../errors';

describe('describeError', () => {
  it('returns the message of an Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('returns non-empty strings as-is', () => {
    expect(describeError('Not Found')).toBe('Not Found');
  });

  it('prefers well-known message-ish properties', () => {
    expect(describeError({ message: 'Bad credentials', status: 401 })).toBe('Bad credentials');
    expect(describeError({ error_description: 'token expired' })).toBe('token expired');
    expect(describeError({ error: 'forbidden' })).toBe('forbidden');
  });

  it('falls back to JSON instead of [object Object]', () => {
    expect(describeError({ status: 404 })).toBe('{"status":404}');
  });

  it('labels empty or missing values', () => {
    expect(describeError(null)).toBe('Unknown error');
    expect(describeError(undefined)).toBe('Unknown error');
    expect(describeError('')).toBe('Unknown error');
    expect(describeError({})).toBe('Unknown error');
  });

  it('survives circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe('Unknown error');
  });

  it('unwraps a GitHub error body carried as a JSON string', () => {
    const body = JSON.stringify({
      message: 'Not Found',
      documentation_url: 'https://docs.github.com/rest',
      status: '404',
    });
    expect(describeError({ message: body })).toBe('Not Found');
    expect(describeError(body)).toBe('Not Found');
    expect(describeError(new Error(body))).toBe('Not Found');
  });

  it('keeps the raw text when a JSON body has no message', () => {
    expect(describeError('{"status":"404"}')).toBe('{"status":"404"}');
    expect(describeError('plain failure')).toBe('plain failure');
  });
});
