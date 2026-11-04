import { useCallback, useEffect, useRef, useState } from 'react';
import { GitHubService } from '../../services/githubService';
import {
  createIssue,
  listIssues,
  saveIssue,
  setIssueStatus,
} from '../../services/issues/issueStore';
import { describeError } from '../../services/errors';
import type { Issue, IssueDraft, IssueStatus, IssueViewer } from '../../types';

export interface UseIssuesResult {
  issues: Issue[];
  viewer: IssueViewer | undefined;
  loading: boolean;
  /** Set when storage can't be read at all. */
  unavailable: boolean;
  /** Set when the last action failed; cleared on the next attempt. */
  error: string | undefined;
  /** Id of the issue currently being written, so its row can show progress. */
  busyId: string | undefined;
  saving: boolean;
  refresh: () => Promise<void>;
  create: (draft: IssueDraft) => Promise<boolean>;
  save: (issue: Issue, draft: IssueDraft) => Promise<boolean>;
  setStatus: (issue: Issue, status: IssueStatus) => Promise<boolean>;
  dismissError: () => void;
}

/**
 * Resolve who is writing, for attribution only. Falls back to an anonymous
 * local author when the GitHub identity can't be resolved.
 */
const LOCAL_VIEWER: IssueViewer = { id: 'local' };

async function resolveViewer(): Promise<IssueViewer> {
  const gitUser = await GitHubService.getAuthenticatedUser().catch(() => undefined);
  if (gitUser?.login) return { id: gitUser.login, login: gitUser.login, name: gitUser.name };
  return LOCAL_VIEWER;
}

/**
 * Loads the notes list and exposes the mutations the panel needs.
 *
 * Every mutation updates local state from the stored record rather than
 * refetching the whole list.
 */
export function useIssues(): UseIssuesResult {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [viewer, setViewer] = useState<IssueViewer | undefined>();
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const list = await listIssues();
      if (!mounted.current) return;
      setIssues(list);
      setUnavailable(false);
    } catch (e) {
      if (!mounted.current) return;
      setUnavailable(true);
      setError(describeError(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void resolveViewer().then((v) => {
      if (mounted.current) setViewer(v);
    });
    // Deferred by a microtask so the first load doesn't set state synchronously
    // inside the effect body; it still starts before the browser paints.
    void Promise.resolve().then(refresh);
  }, [refresh]);

  /** Fold a written issue back into the list, replacing or prepending it. */
  const upsert = useCallback((next: Issue) => {
    setIssues((prev) => {
      const i = prev.findIndex((x) => x.id === next.id);
      if (i === -1) return [next, ...prev];
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  }, []);

  const run = useCallback(
    async (id: string | undefined, work: () => Promise<Issue>): Promise<boolean> => {
      setError(undefined);
      setBusyId(id);
      setSaving(true);
      try {
        const next = await work();
        if (mounted.current) upsert(next);
        return true;
      } catch (e) {
        if (mounted.current) setError(describeError(e));
        return false;
      } finally {
        if (mounted.current) {
          setBusyId(undefined);
          setSaving(false);
        }
      }
    },
    [upsert],
  );

  const create = useCallback(
    (draft: IssueDraft) => {
      return run(undefined, () => createIssue(draft, viewer ?? LOCAL_VIEWER));
    },
    [run, viewer],
  );

  const save = useCallback(
    (issue: Issue, draft: IssueDraft) => run(issue.id, () => saveIssue(issue, draft)),
    [run],
  );

  const setStatus = useCallback(
    (issue: Issue, status: IssueStatus) => {
      return run(issue.id, () => setIssueStatus(issue, status, viewer ?? LOCAL_VIEWER));
    },
    [run, viewer],
  );

  const dismissError = useCallback(() => setError(undefined), []);

  return {
    issues,
    viewer,
    loading,
    unavailable,
    error,
    busyId,
    saving,
    refresh,
    create,
    save,
    setStatus,
    dismissError,
  };
}
