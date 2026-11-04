import { describe, it, expect } from 'vitest';
import { graphQlErrorMessage, graphQlPayload } from '../graphQlEnvelope';

describe('graphQlErrorMessage', () => {
  it('says nothing about a clean response', () => {
    expect(graphQlErrorMessage({ data: { repository: null } })).toBeUndefined();
    expect(graphQlErrorMessage(undefined)).toBeUndefined();
  });

  it('reads the first message GitHub bothered to give', () => {
    expect(
      graphQlErrorMessage({ errors: [{ message: 'Resource not accessible' }, { message: 'two' }] }),
    ).toBe('Resource not accessible');
  });

  it('skips entries with nothing readable on them', () => {
    expect(graphQlErrorMessage({ errors: [{}, { message: 'the real one' }] })).toBe('the real one');
  });

  it('still admits to a refusal it cannot quote', () => {
    expect(graphQlErrorMessage({ errors: [{}] })).toBe('GitHub rejected the request.');
  });

  it('treats an empty errors array as no error, because it is one', () => {
    expect(graphQlErrorMessage({ errors: [] })).toBeUndefined();
  });
});

describe('graphQlPayload', () => {
  it('reaches through the connector’s envelope to GitHub’s own data', () => {
    expect(graphQlPayload({ data: { repository: { id: 'R_1' } } })).toEqual({
      repository: { id: 'R_1' },
    });
  });

  it('answers nothing when there is no envelope to read', () => {
    expect(graphQlPayload(undefined)).toBeUndefined();
    expect(graphQlPayload('not an envelope')).toBeUndefined();
    expect(graphQlPayload({})).toBeUndefined();
  });
});
