import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createComment,
  listComments,
  saveComment,
} from '../../services/issues/commentStore';
import { describeError } from '../../services/errors';
import type { FeedbackComment, FeedbackCommentDraft, IssueViewer } from '../../types';

export interface UseIssueCommentsResult {
  comments: FeedbackComment[];
  loading: boolean;
  /** Set when the last action failed; cleared on the next attempt. */
  error: string | undefined;
  /** Id of the comment currently being written, so its row can show progress. */
  busyId: string | undefined;
  posting: boolean;
  refresh: () => Promise<void>;
  post: (draft: FeedbackCommentDraft) => Promise<boolean>;
  save: (comment: FeedbackComment, draft: FeedbackCommentDraft) => Promise<boolean>;
}

/**
 * Loads and mutates one issue's comment thread.
 *
 * Threads are fetched per item rather than all at once: only an expanded row
 * needs them.
 */
export function useIssueComments(
  issueId: string,
  viewer: IssueViewer | undefined,
): UseIssueCommentsResult {
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [posting, setPosting] = useState(false);
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
      const list = await listComments(issueId);
      if (mounted.current) setComments(list);
    } catch (e) {
      if (mounted.current) setError(describeError(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [issueId]);

  useEffect(() => {
    // Deferred by a microtask so the first load doesn't set state synchronously
    // inside the effect body; it still starts before the browser paints. Same
    // shape as `useIssues`.
    void Promise.resolve().then(refresh);
  }, [refresh]);

  /** Fold a written comment back into the thread, replacing or appending it. */
  const upsert = useCallback((next: FeedbackComment) => {
    setComments((prev) => {
      const i = prev.findIndex((c) => c.id === next.id);
      if (i === -1) return [...prev, next];
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  }, []);

  const run = useCallback(
    async (
      id: string | undefined,
      work: () => Promise<FeedbackComment>,
    ): Promise<boolean> => {
      setError(undefined);
      setBusyId(id);
      setPosting(true);
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
          setPosting(false);
        }
      }
    },
    [upsert],
  );

  const post = useCallback(
    (draft: FeedbackCommentDraft) => {
      return run(undefined, () => createComment(issueId, draft, viewer ?? { id: 'local' }));
    },
    [issueId, run, viewer],
  );

  const save = useCallback(
    (comment: FeedbackComment, draft: FeedbackCommentDraft) =>
      run(comment.id, () => saveComment(comment, draft)),
    [run],
  );

  return { comments, loading, error, busyId, posting, refresh, post, save };
}
