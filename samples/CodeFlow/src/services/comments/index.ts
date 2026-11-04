import type { CommentStore } from './CommentStore';
import { GitHubCommentStore } from './GitHubCommentStore';
import { LocalCommentStore } from './LocalCommentStore';
import type { CommentThread } from '../../types';
import { createLogger } from '../../lib/logger';

export type { CommentStore, CreateThreadInput } from './CommentStore';
export { LocalCommentStore } from './LocalCommentStore';
export { GitHubCommentStore } from './GitHubCommentStore';

const log = createLogger('comments');

let github: CommentStore | null = null;

/** The comment store used by default: comments live on GitHub. */
export function getCommentStore(): CommentStore {
  github ??= new GitHubCommentStore();
  return github;
}

/** Replace the default store (tests, alternative backends). */
export function setCommentStore(store: CommentStore | null): void {
  github = store;
}

export interface LoadedThreads {
  store: CommentStore;
  threads: CommentThread[];
}

/**
 * Load a PR's threads from GitHub, falling back to comments kept in this
 * browser only when GitHub genuinely can't be read (offline, no permission, an
 * API error). The returned store is the one later writes should go to.
 */
export async function loadThreadsWithFallback(prKey: string): Promise<LoadedThreads> {
  const store = getCommentStore();
  try {
    return { store, threads: await store.listThreads(prKey) };
  } catch (error) {
    log.warn('could not read comments from GitHub; using comments kept in this browser', error);
    const local = new LocalCommentStore();
    return { store: local, threads: await local.listThreads(prKey) };
  }
}
