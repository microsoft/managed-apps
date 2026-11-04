import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_ISSUE_STATUSES,
  CLOSED_ISSUE_STATUSES,
  createIssue,
  IssueValidationError,
  listIssues,
  normalizeDraft,
  saveIssue,
  setIssueStatus,
  toIssue,
  TITLE_MAX_LENGTH,
} from '../issueStore';
import { appStorage } from '../../../storage';
import type { IssueViewer } from '../../../types';

const viewer: IssueViewer = { id: 'octocat', login: 'octocat', name: 'Octo Cat' };

describe('toIssue', () => {
  it('maps a stored record onto the domain model', () => {
    const issue = toIssue({
      id: 'f1',
      version: '3',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Crash on load',
      body: 'Steps…',
      kind: 'bug',
      status: 'pending',
      authorId: 'octocat',
      authorLogin: 'octocat',
    });
    expect(issue).toMatchObject({ id: 'f1', version: '3', title: 'Crash on load', status: 'pending' });
  });
});

describe('normalizeDraft', () => {
  it('trims the title and body', () => {
    expect(normalizeDraft({ title: '  Hi  ', body: ' there ', kind: 'idea' })).toEqual({
      title: 'Hi',
      body: 'there',
      kind: 'idea',
    });
  });

  it('rejects an empty or over-long title', () => {
    expect(() => normalizeDraft({ title: '   ', body: '', kind: 'bug' })).toThrow(IssueValidationError);
    expect(() => normalizeDraft({ title: 'x'.repeat(TITLE_MAX_LENGTH + 1), body: '', kind: 'bug' })).toThrow(
      IssueValidationError,
    );
  });
});

describe('storage round trip', () => {
  it('creates an open item attributed to the viewer', async () => {
    const issue = await createIssue({ title: 'Idea', body: 'More colour', kind: 'idea' }, viewer);
    expect(issue).toMatchObject({ title: 'Idea', status: 'open', authorLogin: 'octocat' });
    expect(issue.appVersion).toBeTruthy();
    expect(await appStorage().feedback.get(issue.id)).toMatchObject({ title: 'Idea' });
  });

  it('lists newest activity first', async () => {
    const first = await createIssue({ title: 'First', body: '', kind: 'bug' }, viewer);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await createIssue({ title: 'Second', body: '', kind: 'bug' }, viewer);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await saveIssue(first, { title: 'First (edited)', body: '', kind: 'bug' });
    expect((await listIssues()).map((i) => i.title)).toEqual(['First (edited)', 'Second']);
  });

  it('saves an edit and leaves status alone', async () => {
    const issue = await createIssue({ title: 'Typo', body: '', kind: 'bug' }, viewer);
    const closed = await setIssueStatus(issue, 'closed', viewer);
    const edited = await saveIssue(closed, { title: 'Typo in header', body: 'b', kind: 'bug' });
    expect(edited).toMatchObject({ title: 'Typo in header', status: 'closed' });
  });

  it('records who closed an item and clears it on reopen', async () => {
    const issue = await createIssue({ title: 'Done soon', body: '', kind: 'bug' }, viewer);
    const closed = await setIssueStatus(issue, 'wontfix', viewer);
    expect(closed).toMatchObject({ status: 'wontfix', closedBy: 'octocat' });
    expect(closed.closedAt).toBeTruthy();
    const reopened = await setIssueStatus(closed, 'open', viewer);
    expect(reopened.closedBy).toBeUndefined();
    expect(reopened.closedAt).toBeUndefined();
  });

  it('falls back to the stable id when the viewer has no login', async () => {
    const issue = await createIssue({ title: 'Anon', body: '', kind: 'bug' }, { id: 'local' });
    const closed = await setIssueStatus(issue, 'closed', { id: 'local' });
    expect(closed.closedBy).toBe('local');
  });

  it('re-applies the intent to a fresh copy after a conflict', async () => {
    const issue = await createIssue({ title: 'Race', body: '', kind: 'bug' }, viewer);
    // Someone else edits it first, so our copy's version is stale.
    await saveIssue(issue, { title: 'Race (theirs)', body: 'x', kind: 'bug' });
    const closed = await setIssueStatus(issue, 'closed', viewer);
    expect(closed).toMatchObject({ title: 'Race (theirs)', status: 'closed' });
  });

  it('explains a conflict against an item that has since vanished', async () => {
    const issue = await createIssue({ title: 'Gone', body: '', kind: 'bug' }, viewer);
    await saveIssue(issue, { title: 'Gone soon', body: '', kind: 'bug' });
    await appStorage().feedback.delete(issue.id);
    await expect(setIssueStatus(issue, 'closed', viewer)).rejects.toThrow(/no longer exists/);
  });

  it('does not retry a non-conflict failure', async () => {
    const issue = await createIssue({ title: 'Boom', body: '', kind: 'bug' }, viewer);
    const put = vi.spyOn(appStorage().feedback, 'put').mockRejectedValue(new Error('offline'));
    await expect(setIssueStatus(issue, 'closed', viewer)).rejects.toThrow('offline');
    expect(put).toHaveBeenCalledTimes(1);
  });
});

describe('status vocabulary', () => {
  it('splits cleanly into the live half and the finished half', () => {
    expect([...ACTIVE_ISSUE_STATUSES, ...CLOSED_ISSUE_STATUSES].sort()).toEqual(
      ['blocked', 'closed', 'open', 'pending', 'wontfix'],
    );
  });
});
