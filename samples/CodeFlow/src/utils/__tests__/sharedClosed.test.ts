import { describe, it, expect } from 'vitest';
import {
  UNKNOWN_AT,
  applyClosed,
  closedAttribution,
  closedFlags,
  mergeSharedClosed,
  normalizeSharedClosed,
  type SharedClosedMap,
} from '../sharedClosed';

const at = (iso: string) => iso;

describe('normalizeSharedClosed', () => {
  it('ignores bare booleans, which are not a stored shape', () => {
    expect(normalizeSharedClosed({ 'thread-1': true, 'thread-2': false })).toEqual({});
  });

  it('keeps attribution on current-shape entries', () => {
    const map = normalizeSharedClosed({
      'thread-1': { by: 'gh:1', login: 'ada', at: at('2024-05-01T00:00:00.000Z'), closed: true },
    });

    expect(map['thread-1']).toEqual({
      by: 'gh:1',
      login: 'ada',
      at: '2024-05-01T00:00:00.000Z',
      closed: true,
    });
  });

  it('preserves tombstones rather than dropping them as falsy', () => {
    const map = normalizeSharedClosed({
      'thread-1': { by: 'gh:1', at: at('2024-05-01T00:00:00.000Z'), closed: false },
    });

    expect(map['thread-1'].closed).toBe(false);
  });

  it('discards anything that is not a usable entry', () => {
    expect(normalizeSharedClosed(undefined)).toEqual({});
    expect(normalizeSharedClosed(null)).toEqual({});
    expect(normalizeSharedClosed('nope')).toEqual({});
    expect(normalizeSharedClosed(['a'])).toEqual({});
    expect(normalizeSharedClosed({ 'thread-1': { by: 'gh:1' } })).toEqual({});
  });

  it('omits an empty login rather than storing a blank author', () => {
    const map = normalizeSharedClosed({
      'thread-1': { by: 'gh:1', login: '', at: at('2024-05-01T00:00:00.000Z'), closed: true },
    });

    expect(map['thread-1']).not.toHaveProperty('login');
  });
});

describe('mergeSharedClosed', () => {
  it('takes the most recent action for a thread', () => {
    const local: SharedClosedMap = {
      't': { by: 'gh:1', at: at('2024-05-01T00:00:00.000Z'), closed: true },
    };
    const remote: SharedClosedMap = {
      't': { by: 'gh:2', at: at('2024-05-02T00:00:00.000Z'), closed: false },
    };

    expect(mergeSharedClosed(local, remote).t).toEqual(remote.t);
    // Order of arguments must not change the outcome.
    expect(mergeSharedClosed(remote, local).t).toEqual(remote.t);
  });

  it('unions threads only one side knows about', () => {
    const local: SharedClosedMap = {
      a: { by: 'gh:1', at: at('2024-05-01T00:00:00.000Z'), closed: true },
    };
    const remote: SharedClosedMap = {
      b: { by: 'gh:2', at: at('2024-05-01T00:00:00.000Z'), closed: true },
    };

    expect(Object.keys(mergeSharedClosed(local, remote)).sort()).toEqual(['a', 'b']);
  });

  it('does not let a stale device resurrect a thread somebody reopened', () => {
    // The bug this whole shape exists to prevent: before tombstones, reopening
    // deleted the key, so any device still holding `true` re-added it.
    const staleDevice: SharedClosedMap = {
      t: { by: 'gh:1', at: UNKNOWN_AT, closed: true },
    };
    const reopened: SharedClosedMap = {
      t: { by: 'gh:2', login: 'ada', at: at('2024-05-02T00:00:00.000Z'), closed: false },
    };

    const merged = mergeSharedClosed(staleDevice, reopened);
    expect(merged.t.closed).toBe(false);
    expect(closedFlags(merged)).toEqual({});
  });

  it('breaks ties towards closed', () => {
    const a: SharedClosedMap = { t: { by: 'gh:1', at: UNKNOWN_AT, closed: true } };
    const b: SharedClosedMap = { t: { by: 'gh:2', at: UNKNOWN_AT, closed: false } };

    expect(mergeSharedClosed(a, b).t.closed).toBe(true);
    expect(mergeSharedClosed(b, a).t.closed).toBe(true);
  });

  it('leaves its inputs untouched', () => {
    const local: SharedClosedMap = {
      t: { by: 'gh:1', at: at('2024-05-01T00:00:00.000Z'), closed: true },
    };
    const remote: SharedClosedMap = {};

    mergeSharedClosed(local, remote);

    expect(remote).toEqual({});
    expect(local.t.closed).toBe(true);
  });
});

describe('applyClosed', () => {
  const now = () => new Date('2024-06-01T12:00:00.000Z');

  it('records who closed a thread and when', () => {
    const map = applyClosed({}, 't', true, { by: 'gh:1', login: 'ada' }, now);

    expect(map.t).toEqual({
      by: 'gh:1',
      login: 'ada',
      at: '2024-06-01T12:00:00.000Z',
      closed: true,
    });
  });

  it('writes a tombstone on reopen instead of dropping the key', () => {
    const closed = applyClosed({}, 't', true, { by: 'gh:1' }, now);
    const reopened = applyClosed(closed, 't', false, { by: 'gh:2', login: 'bo' }, now);

    expect(reopened.t.closed).toBe(false);
    expect(reopened.t.by).toBe('gh:2');
    expect(closedFlags(reopened)).toEqual({});
  });

  it('omits login when the actor has no display name', () => {
    const map = applyClosed({}, 't', true, { by: 'gh:1' }, now);
    expect(map.t).not.toHaveProperty('login');
  });
});

describe('closedFlags / closedAttribution', () => {
  const map: SharedClosedMap = {
    open: { by: 'gh:1', at: at('2024-05-02T00:00:00.000Z'), closed: false },
    shut: { by: 'gh:2', login: 'ada', at: at('2024-05-01T00:00:00.000Z'), closed: true },
  };

  it('exposes only closed threads to the view layer', () => {
    expect(closedFlags(map)).toEqual({ shut: true });
  });

  it('attributes only closed threads', () => {
    expect(Object.keys(closedAttribution(map))).toEqual(['shut']);
    expect(closedAttribution(map).shut.login).toBe('ada');
  });
});
