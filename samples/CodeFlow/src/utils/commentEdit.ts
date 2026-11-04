import type { Comment, GitUserRef } from '../types';
import { isPendingCommentId } from './pendingComment';

/**
 * Whether the signed-in reviewer can edit this comment.
 *
 * Three things have to hold, and each corresponds to a way the edit would
 * otherwise fail in front of the reader rather than never being offered:
 *
 * - GitHub only lets a comment's author edit it, and answers anyone else with a
 *   permission error, so the button is only shown to the author.
 * - A comment that hasn't been acknowledged by the server yet has no identity to
 *   address — it's still holding the temporary id the optimistic update gave it.
 * - A comment that came from GitHub can only be rewritten by GraphQL node id,
 *   which is recovered on read and may be missing if that pass failed. Comments
 *   held locally have no such requirement.
 */
export function canEditComment(comment: Comment, currentUser?: GitUserRef): boolean {
  const me = currentUser?.login?.trim();
  if (!me) return false;
  if (comment.author.login.toLowerCase() !== me.toLowerCase()) return false;
  if (isPendingCommentId(comment.id)) return false;
  return comment.local === true || !!comment.nodeId;
}

/** Deletion uses the same author and persisted-identity requirements as editing. */
export function canDeleteComment(comment: Comment, currentUser?: GitUserRef): boolean {
  return canEditComment(comment, currentUser);
}
