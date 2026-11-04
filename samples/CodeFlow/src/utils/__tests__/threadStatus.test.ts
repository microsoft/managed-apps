import { describe, it, expect } from 'vitest';
import {
  THREAD_STATUS_LABELS,
  threadDisplayStatus,
  threadStatusLabel,
  threadStatusTitle,
} from '../threadStatus';

describe('threadDisplayStatus', () => {
  it('uses the GitHub status when the thread is not closed', () => {
    expect(threadDisplayStatus({ status: 'active' })).toBe('active');
    expect(threadDisplayStatus({ status: 'resolved' })).toBe('resolved');
    expect(threadDisplayStatus({ status: 'active', closed: false })).toBe('active');
  });

  it('lets the local closed flag supersede the GitHub status', () => {
    expect(threadDisplayStatus({ status: 'active', closed: true })).toBe('closed');
    expect(threadDisplayStatus({ status: 'resolved', closed: true })).toBe('closed');
  });
});

describe('threadStatusLabel', () => {
  it('renders exactly one label per thread', () => {
    expect(threadStatusLabel({ status: 'active' })).toBe('Active');
    expect(threadStatusLabel({ status: 'resolved' })).toBe('Resolved');
    expect(threadStatusLabel({ status: 'active', closed: true })).toBe('Closed');
    expect(threadStatusLabel({ status: 'resolved', closed: true })).toBe('Closed');
  });

  it('never concatenates the closed flag onto the base status', () => {
    expect(threadStatusLabel({ status: 'active', closed: true })).not.toContain('Active');
  });
});

describe('threadStatusTitle', () => {
  it('has no tooltip for open threads', () => {
    expect(threadStatusTitle({ status: 'active' })).toBeUndefined();
    expect(threadStatusTitle({ status: 'resolved', closed: false })).toBeUndefined();
  });

  it('keeps the underlying GitHub status in the tooltip when closed', () => {
    expect(threadStatusTitle({ status: 'active', closed: true })).toContain(
      'GitHub status: Active',
    );
    expect(threadStatusTitle({ status: 'resolved', closed: true })).toContain(
      'GitHub status: Resolved',
    );
  });

  it('names whoever closed the thread', () => {
    expect(threadStatusTitle({ status: 'active', closed: true, closedBy: { login: 'ada' } })).toBe(
      'Closed by @ada · shared with all reviewers, not a GitHub state · GitHub status: Active',
    );
  });

  it('does not guess an author when attribution is unknown', () => {
    // State carried over from before closing was shared has no recorded author.
    const title = threadStatusTitle({ status: 'active', closed: true, closedBy: {} });
    expect(title).toContain('Closed ·');
    expect(title).not.toContain('@');
  });

  it('says the state is shared rather than local', () => {
    const title = threadStatusTitle({ status: 'active', closed: true });
    expect(title).toContain('shared with all reviewers');
    expect(title).not.toContain('locally');
  });
});

describe('THREAD_STATUS_LABELS', () => {
  it('covers every display status', () => {
    expect(THREAD_STATUS_LABELS).toEqual({
      active: 'Active',
      resolved: 'Resolved',
      closed: 'Closed',
    });
  });
});
