import { useCallback, useRef } from 'react';
import type { CommentThread, CommentThreadStatus } from '../../types';
import type { CreateThreadInput } from '../../services/comments';
import type { CommentStore } from '../../services/comments/CommentStore';
import type { CodeFlowState } from '../codeFlowContext';
import {
  prKey as makePrKey,
  setThreadClosed as storeThreadClosed,
  getClosedAttribution,
} from '../../utils/storage';
import { newPendingId } from '../../utils/pendingComment';
import { createLogger } from '../../lib/logger';
import { withReviewedIteration } from './reviewedIteration';
import { sameThreads } from '../../utils/sameThreads';
import { canDeleteComment } from '../../utils/commentEdit';

const log = createLogger('comments');

/**
 * How long a status we have just written is trusted over what a read reports.
 *
 * GitHub's review threads are not read-your-writes consistent. The
 * unresolve mutation comes back successful and a read issued a moment later can
 * still say the thread is resolved — and since every write is followed by a
 * refresh, that stale answer was handed straight back into state. A thread set
 * to Active flipped back to Resolved about a second later, and it did it again
 * on every retry, so there was no way to reopen a thread at all.
 *
 * A pin is dropped the moment a read agrees with it, so this window only bounds
 * the case where the server never catches up — after which the server wins
 * again rather than the app insisting forever on a write that didn't take.
 */
const STATUS_PIN_MS = 30_000;

interface StatusPin {
  status: CommentThreadStatus;
  until: number;
}

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

export function useCommentActions(
  prKeyStr: string | undefined,
  state: CodeFlowState,
  setState: SetState,
  storeRef: React.MutableRefObject<CommentStore>,
) {
  const pinnedStatus = useRef(new Map<string, StatusPin>());

  /**
   * Re-assert statuses the reviewer has just set over whatever the read says.
   *
   * Applied to the fetched list rather than to state afterwards, so the
   * identity check below still sees a list that matches what is on screen and
   * a poll that changed nothing stays a no-op.
   */
  const applyStatusPins = useCallback((threads: CommentThread[]): CommentThread[] => {
    const pins = pinnedStatus.current;
    if (pins.size === 0) return threads;
    const now = Date.now();
    return threads.map((t) => {
      const pin = pins.get(t.id);
      if (!pin) return t;
      // Expired, or the server has caught up — either way stop overriding it.
      if (pin.until <= now || t.status === pin.status) {
        pins.delete(t.id);
        return t;
      }
      return { ...t, status: pin.status };
    });
  }, []);

  const refreshThreads = useCallback(async () => {
    if (!prKeyStr) return;
    const threads = applyStatusPins(await storeRef.current.listThreads(prKeyStr));
    setState((s) => {
      const currentKey = s.pr ? makePrKey(s.pr.coordinates) : undefined;
      if (currentKey !== prKeyStr) return s;
      // A poll that found nothing new keeps the array it already had. The
      // fetch hands back fresh objects every time, and swapping them in would
      // invalidate every memo hanging off `threads` — re-rendering each line of
      // the open file on a timer, which on a long file is a visible freeze.
      if (sameThreads(s.threads, threads)) return s;
      return { ...s, threads };
    });
  }, [prKeyStr, storeRef, setState, applyStatusPins]);

  const createThread = useCallback(
    async (input: Omit<CreateThreadInput, 'prKey' | 'author'>) => {
      if (!prKeyStr) return;
      const author = state.currentUser ?? { login: 'you' };
      const tempId = newPendingId();
      const now = new Date().toISOString();
      const optimistic: CommentThread = {
        id: tempId,
        prKey: prKeyStr,
        filename: input.filename,
        side: input.side,
        line: input.line,
        startLine: input.startLine,
        status: 'active',
        comments: [{ id: tempId, author, body: input.body, createdAt: now }],
        createdAt: now,
        updatedAt: now,
        iterationIndex: input.iterationIndex,
      };
      setState((s) =>
        withReviewedIteration({ ...s, threads: [...s.threads, optimistic] }, prKeyStr),
      );
      try {
        const created = await storeRef.current.createThread({ ...input, prKey: prKeyStr, author });
        setState((s) => ({
          ...s,
          threads: s.threads.map((t) => (t.id === tempId ? created : t)),
        }));
        setTimeout(() => void refreshThreads(), 2000);
      } catch (err) {
        log.error('createThread failed', err);
        setState((s) => ({ ...s, threads: s.threads.filter((t) => t.id !== tempId) }));
        // Re-throw so the composer can surface the failure and keep the draft
        // instead of the comment silently vanishing.
        throw err;
      }
    },
    [prKeyStr, state.currentUser, refreshThreads, storeRef, setState],
  );

  const addComment = useCallback(
    async (threadId: string, body: string) => {
      if (!prKeyStr) return;
      const author = state.currentUser ?? { login: 'you' };
      const tempCommentId = newPendingId();
      const now = new Date().toISOString();
      setState((s) =>
        withReviewedIteration(
          {
            ...s,
            threads: s.threads.map((t) =>
              t.id === threadId
                ? {
                    ...t,
                    updatedAt: now,
                    comments: [...t.comments, { id: tempCommentId, author, body, createdAt: now }],
                  }
                : t,
            ),
          },
          prKeyStr,
        ),
      );
      try {
        const known = state.threads.find((t) => t.id === threadId);
        const updated = await storeRef.current.addComment(prKeyStr, threadId, body, author, known);
        setState((s) => ({
          ...s,
          threads: s.threads.map((t) => (t.id === threadId ? updated : t)),
        }));
        setTimeout(() => void refreshThreads(), 2000);
      } catch (err) {
        log.error('addComment failed', err);
        setState((s) => ({
          ...s,
          threads: s.threads.map((t) =>
            t.id === threadId
              ? { ...t, comments: t.comments.filter((c) => c.id !== tempCommentId) }
              : t,
          ),
        }));
        throw err;
      }
    },
    [prKeyStr, state.currentUser, state.threads, refreshThreads, storeRef, setState],
  );

  const editComment = useCallback(
    async (threadId: string, commentId: string, body: string) => {
      if (!prKeyStr) return;
      const now = new Date().toISOString();
      let previous: string | undefined;
      setState((s) => ({
        ...s,
        threads: s.threads.map((t) =>
          t.id === threadId
            ? {
                ...t,
                updatedAt: now,
                comments: t.comments.map((c) => {
                  if (c.id !== commentId) return c;
                  previous = c.body;
                  return { ...c, body };
                }),
              }
            : t,
        ),
      }));
      try {
        const known = state.threads.find((t) => t.id === threadId);
        const updated = await storeRef.current.editComment(
          prKeyStr,
          threadId,
          commentId,
          body,
          known,
        );
        setState((s) => ({
          ...s,
          threads: s.threads.map((t) => (t.id === threadId ? updated : t)),
        }));
        setTimeout(() => void refreshThreads(), 2000);
      } catch (err) {
        log.error('editComment failed', err);
        // Put the old text back, so a refused edit doesn't leave the reader
        // looking at a version GitHub never accepted.
        if (previous !== undefined) {
          const restored = previous;
          setState((s) => ({
            ...s,
            threads: s.threads.map((t) =>
              t.id === threadId
                ? {
                    ...t,
                    comments: t.comments.map((c) =>
                      c.id === commentId ? { ...c, body: restored } : c,
                    ),
                  }
                : t,
            ),
          }));
        }
        throw err;
      }
    },
    [prKeyStr, state.threads, refreshThreads, storeRef, setState],
  );

  const setThreadStatus = useCallback(
    async (threadId: string, status: CommentThreadStatus) => {
      if (!prKeyStr) return;
      let prevStatus: CommentThreadStatus | undefined;
      setState((s) => ({
        ...s,
        threads: s.threads.map((t) => {
          if (t.id === threadId) {
            prevStatus = t.status;
            return { ...t, status };
          }
          return t;
        }),
      }));
      // Pinned before the write, not after: a poll can land while the mutation
      // is still in flight, and it would report the old status just as happily
      // as the read-back does.
      pinnedStatus.current.set(threadId, { status, until: Date.now() + STATUS_PIN_MS });
      try {
        await storeRef.current.setStatus(prKeyStr, threadId, status);
        await refreshThreads();
      } catch (err) {
        log.error('setThreadStatus failed', err);
        pinnedStatus.current.delete(threadId);
        if (prevStatus != null) {
          setState((s) => ({
            ...s,
            threads: s.threads.map((t) =>
              t.id === threadId ? { ...t, status: prevStatus! } : t,
            ),
          }));
        }
        // Re-thrown so the thread view can say why the status snapped back.
        // Reverting in silence is indistinguishable from the app undoing the
        // change on its own, which is how this was reported the first time.
        throw err;
      }
    },
    [prKeyStr, refreshThreads, storeRef, setState],
  );

  const deleteComment = useCallback(
    async (threadId: string, commentId: string) => {
      try {
        if (!prKeyStr) throw new Error('No pull request is loaded.');
        const known = state.threads.find((t) => t.id === threadId);
        const comment = known?.comments.find((c) => c.id === commentId);
        if (!comment) throw new Error('Comment not found');
        if (!canDeleteComment(comment, state.currentUser)) {
          throw new Error('Only your own saved comments can be deleted.');
        }
        await storeRef.current.deleteComment(prKeyStr, threadId, commentId, known);
        // Leave the comment visible until GitHub confirms: a failed write must
        // not unmount the thread and take its error message and drafts with it.
        setState((s) => {
          if (!s.pr || makePrKey(s.pr.coordinates) !== prKeyStr) return s;
          const threads = s.threads.flatMap((t) => {
            if (t.id !== threadId) return [t];
            const comments = t.comments.filter((c) => c.id !== commentId);
            return comments.length ? [{ ...t, comments }] : [];
          });
          return { ...s, threads };
        });
      } catch (err) {
        log.error('deleteComment failed', err);
        throw err;
      }
    },
    [prKeyStr, state.threads, state.currentUser, storeRef, setState],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!prKeyStr) return;
      let removed: CommentThread | undefined;
      setState((s) => {
        removed = s.threads.find((t) => t.id === threadId);
        return { ...s, threads: s.threads.filter((t) => t.id !== threadId) };
      });
      try {
        await storeRef.current.deleteThread(prKeyStr, threadId);
        await refreshThreads();
      } catch (err) {
        log.warn('deleteThread failed', err);
        if (removed) {
          setState((s) => ({ ...s, threads: [...s.threads, removed!] }));
        }
      }
    },
    [prKeyStr, refreshThreads, storeRef, setState],
  );

  const setThreadClosed = useCallback(
    (threadId: string, closed: boolean) => {
      if (!prKeyStr) return;
      // Close state is shared with the other reviewers, so record who did it.
      const map = storeThreadClosed(prKeyStr, threadId, closed, {
        by: state.currentUser?.login ?? '',
        login: state.currentUser?.login,
      });
      const closedBy = getClosedAttribution(prKeyStr);
      setState((s) => ({ ...s, closed: map, closedBy }));

      // Also sync the resolved status to GitHub. Issue comments don't support
      // resolve/unresolve so skip those. Fire-and-forget: the local closed
      // flag is the primary signal; GitHub sync is best-effort.
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread?.isIssueComment) {
        const status: CommentThreadStatus = closed ? 'resolved' : 'active';
        setState((s) => ({
          ...s,
          threads: s.threads.map((t) => (t.id === threadId ? { ...t, status } : t)),
        }));
        // Same read-back race as setThreadStatus: Reopen unresolves on GitHub,
        // and the next poll can still report the thread as resolved.
        pinnedStatus.current.set(threadId, { status, until: Date.now() + STATUS_PIN_MS });
        storeRef.current.setStatus(prKeyStr, threadId, status).catch((err: unknown) => {
          log.warn('setThreadClosed: GitHub sync failed', err);
          pinnedStatus.current.delete(threadId);
        });
      }
    },
    [prKeyStr, state.currentUser?.login, state.threads, storeRef, setState],
  );

  return {
    refreshThreads,
    createThread,
    addComment,
    editComment,
    deleteComment,
    setThreadStatus,
    setThreadClosed,
    deleteThread,
  };
}
