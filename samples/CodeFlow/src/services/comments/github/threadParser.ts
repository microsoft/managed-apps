/**
 * Parsers that turn GitHub comment data (GraphQL nodes, or REST-shaped rows)
 * into CommentThread[]. Pure functions — no side effects, no network calls.
 */
import type { Comment, CommentThread, DiffSide, GitUserRef } from '../../../types';
import { decodeAnchor, stripAnchor } from './anchorMarker';
import { decodeIssueReplyParent, stripIssueReply } from './issueReplyMarker';
import { deriveCommentId, isNodeId } from './helpers';
import { validStartLine } from '../../../utils/commentRange';

/**
 * Pick the first meaningful (positive) line number from a set of candidates.
 *
 * GitHub returns `line: null` for comments that have gone outdated (the code
 * around them changed) and instead exposes the original anchor as `originalLine`
 * (GraphQL camelCase) or `original_line` (REST snake_case). Falling through to 0
 * is what produced the confusing "R0" anchors, so we prefer any real line —
 * current first, then the original — over 0.
 */
export function pickLine(...candidates: unknown[]): number {
  for (const c of candidates) {
    if (c == null) continue;
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** The stored text of a comment. GraphQL returns it exactly as written. */
export function bodyOf(raw: Record<string, unknown>): string {
  return typeof raw.body === 'string' ? raw.body : '';
}

function reviewAnchor(
  first: Record<string, unknown>,
  thread: Record<string, unknown> = {},
): Pick<CommentThread, 'side' | 'line' | 'startLine'> {
  const marker = decodeAnchor(bodyOf(first));
  if (marker) return marker;
  const side: DiffSide =
    first.side === 'LEFT' || thread.side === 'LEFT' || thread.diffSide === 'LEFT' ? 'left' : 'right';
  // Keep both endpoints in the same coordinate version. An original start
  // paired with a current end would silently point at a different range.
  const sources = [
    ...[first, thread].map((row) => ({
      line: row.line,
      start: row.startLine ?? row.start_line,
      startSide: row.startSide ?? row.start_side ?? row.startDiffSide,
    })),
    ...[first, thread].map((row) => ({
      line: row.originalLine ?? row.original_line,
      start: row.originalStartLine ?? row.original_start_line,
      startSide: row.startSide ?? row.start_side ?? row.startDiffSide,
    })),
  ];
  const source = sources.find((entry) => pickLine(entry.line) > 0);
  const line = pickLine(source?.line);
  const sameSide = source?.startSide == null || String(source.startSide).toLowerCase() === side;
  const startLine = sameSide ? validStartLine(source?.start, line) : undefined;
  return { side, line, ...(startLine !== undefined ? { startLine } : {}) };
}

/** Map a GitHub comment object (from thread.comments[]) to our Comment. */
export function toComment(raw: Record<string, unknown>): Comment {
  const authorRaw = raw.author;
  const userRaw = raw.user;
  let login = 'unknown';
  let name: string | undefined;
  let avatarUrl: string | undefined;

  if (typeof authorRaw === 'string') {
    login = authorRaw;
  } else if (typeof authorRaw === 'object' && authorRaw !== null) {
    const a = authorRaw as Record<string, unknown>;
    login = String(a.login ?? 'unknown');
    name = a.name as string | undefined;
    avatarUrl = (a.avatarUrl ?? a.avatar_url) as string | undefined;
  } else if (typeof userRaw === 'object' && userRaw !== null) {
    const u = userRaw as Record<string, unknown>;
    login = String(u.login ?? 'unknown');
    name = u.name as string | undefined;
    avatarUrl = (u.avatarUrl ?? u.avatar_url) as string | undefined;
  }

  // The database id is the comment's identity in deep links and permalinks;
  // a GraphQL node carries it as `databaseId` (its `id` is the node id).
  let id: unknown = deriveCommentId(raw) ?? raw.id ?? raw.node_id;
  if (!id) id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // The marker preamble is hidden from the reader but has to survive an edit,
  // so keep whatever `stripAnchor` took off rather than throwing it away. It is
  // always a leading block, so the stripped body is a suffix of the original.
  const stored = bodyOf(raw);
  const body = stripAnchor(stored);
  const bodyPrefix = stored.slice(0, stored.length - body.length);
  // The node id is the only handle the edit and delete mutations accept.
  const nodeId = [raw.node_id, raw.nodeId, raw.id].find(isNodeId);
  // GitHub's own permalink, so the "open on GitHub" link never has to guess which
  // anchor shape (`#discussion_r…` vs `#issuecomment-…`) this comment uses.
  const rawHtmlUrl = raw.html_url ?? raw.htmlUrl ?? raw.url;
  const htmlUrl = typeof rawHtmlUrl === 'string' && rawHtmlUrl ? rawHtmlUrl : undefined;

  return {
    id: String(id),
    author: { login, name, avatarUrl },
    body,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    local: false,
    ...(nodeId ? { nodeId } : {}),
    ...(htmlUrl ? { htmlUrl } : {}),
    ...(bodyPrefix ? { bodyPrefix } : {}),
  };
}

/**
 * Convert review threads (GraphQL `reviewThreads.nodes`, already grouped, with
 * isResolved / isOutdated / line metadata) into CommentThread[].
 */
export function parseReviewThreads(
  prKey: string,
  data: unknown,
): CommentThread[] {
  let rawThreads: Record<string, unknown>[];
  if (Array.isArray(data)) {
    rawThreads = data as Record<string, unknown>[];
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    const arr = obj.review_threads ?? obj.threads ?? obj.nodes ?? obj.data ?? obj.value;
    if (Array.isArray(arr)) {
      rawThreads = arr as Record<string, unknown>[];
    } else {
      return groupFlatComments(prKey, data);
    }
  } else {
    return [];
  }

  const threads: CommentThread[] = [];
  for (const rt of rawThreads) {
    let rawComments: Record<string, unknown>[];
    const commentsField = rt.comments;
    if (Array.isArray(commentsField)) {
      rawComments = commentsField as Record<string, unknown>[];
    } else if (typeof commentsField === 'object' && commentsField !== null) {
      const cObj = commentsField as Record<string, unknown>;
      rawComments = (cObj.nodes ?? cObj.edges ?? []) as Record<string, unknown>[];
    } else {
      continue;
    }
    if (rawComments.length === 0) continue;

    const first = rawComments[0] as Record<string, unknown>;
    const resolved = rt.is_resolved === true || rt.isResolved === true;
    const outdated = rt.is_outdated === true || rt.isOutdated === true;

    threads.push({
      id: String(rt.id ?? first.id ?? first.databaseId ?? `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      threadNodeId: isNodeId(rt.id) ? rt.id : '',
      prKey,
      filename: String(first.path ?? rt.path ?? '(unknown)'),
      ...reviewAnchor(first, rt),
      status: resolved ? 'resolved' : 'active',
      ...(outdated ? { outdated: true } : {}),
      comments: rawComments.map((c) => toComment(c as Record<string, unknown>)),
      createdAt: String(
        first.createdAt ?? first.created_at ?? new Date().toISOString(),
      ),
      updatedAt: String(
        rawComments[rawComments.length - 1]?.updatedAt ??
          rawComments[rawComments.length - 1]?.updated_at ??
          rawComments[rawComments.length - 1]?.createdAt ??
          rawComments[rawComments.length - 1]?.created_at ??
          new Date().toISOString(),
      ),
    });
  }
  return threads;
}

/**
 * Fallback: group a flat list of review comments into threads by
 * `in_reply_to_id`.
 */
export function groupFlatComments(
  prKey: string,
  data: unknown,
): CommentThread[] {
  let comments: Record<string, unknown>[];
  if (Array.isArray(data)) {
    comments = data;
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    comments = (obj.comments ?? obj.value ?? []) as Record<string, unknown>[];
  } else {
    return [];
  }

  const roots = new Map<string, Record<string, unknown>[]>();
  for (const c of comments) {
    const replyTo = c.in_reply_to_id as number | undefined;
    const rootId = replyTo ? String(replyTo) : String(c.id);
    if (!roots.has(rootId)) roots.set(rootId, []);
    roots.get(rootId)!.push(c);
  }

  const threads: CommentThread[] = [];
  for (const [rootId, group] of roots) {
    group.sort((a, b) =>
      String(a.created_at ?? a.createdAt ?? '').localeCompare(
        String(b.created_at ?? b.createdAt ?? ''),
      ),
    );
    const root = group[0];
    threads.push({
      id: rootId,
      prKey,
      filename: String(root.path ?? '(unknown)'),
      ...reviewAnchor(root),
      status: 'active',
      comments: group.map(toComment),
      createdAt: String(root.created_at ?? root.createdAt ?? new Date().toISOString()),
      updatedAt: String(
        group[group.length - 1].updated_at ??
          group[group.length - 1].createdAt ??
          new Date().toISOString(),
      ),
    });
  }
  return threads;
}

/**
 * Parse issue comments (top-level PR comments not associated with a file/line)
 * into CommentThread[].
 *
 * Each issue comment becomes its own thread, except replies posted by this app:
 * they carry a marker naming the comment they answer (see issueReplyMarker.ts),
 * and are folded into that comment's thread so the Description conversation
 * stays threaded.
 */
export function parseIssueComments(
  prKey: string,
  data: unknown,
): CommentThread[] {
  let comments: Record<string, unknown>[];
  if (Array.isArray(data)) {
    comments = data;
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    comments = (obj.comments ?? obj.value ?? obj.nodes ?? []) as Record<string, unknown>[];
    if (!Array.isArray(comments)) comments = [];
  } else {
    return [];
  }

  const threads: CommentThread[] = [];
  const byId = new Map<string, CommentThread>();
  const orphans: { parentId: string; comment: Comment; raw: Record<string, unknown> }[] = [];

  for (const c of comments) {
    const comment = toComment(c);
    // Same reasoning as the anchor marker in `toComment`: the reply marker is a
    // leading block, and an edit has to put it back or the reply detaches from
    // the comment it answers.
    const stripped = stripIssueReply(comment.body);
    if (stripped !== comment.body) {
      comment.bodyPrefix =
        (comment.bodyPrefix ?? '') + comment.body.slice(0, comment.body.length - stripped.length);
      comment.body = stripped;
    }
    const id = comment.id;
    const parentId = decodeIssueReplyParent(bodyOf(c));

    if (parentId) {
      const parent = byId.get(parentId);
      if (parent) {
        appendIssueReply(parent, comment, c);
        continue;
      }
      // A reply can only be parsed after its parent, but the API's ordering
      // isn't guaranteed — hold it back and try again once everything is in.
      orphans.push({ parentId, comment, raw: c });
      continue;
    }

    const thread: CommentThread = {
      id,
      prKey,
      filename: '',
      side: 'right' as const,
      line: 0,
      status: 'active' as const,
      isIssueComment: true,
      comments: [comment],
      createdAt: comment.createdAt,
      updatedAt: String(c.updated_at ?? c.updatedAt ?? comment.createdAt),
    };
    byId.set(id, thread);
    threads.push(thread);
  }

  for (const orphan of orphans) {
    const parent = byId.get(orphan.parentId);
    if (parent) {
      appendIssueReply(parent, orphan.comment, orphan.raw);
      continue;
    }
    // The parent is gone (deleted, or on a page we didn't fetch). Showing the
    // reply on its own beats dropping what someone wrote.
    threads.push({
      id: orphan.comment.id,
      prKey,
      filename: '',
      side: 'right' as const,
      line: 0,
      status: 'active' as const,
      isIssueComment: true,
      comments: [orphan.comment],
      createdAt: orphan.comment.createdAt,
      updatedAt: String(orphan.raw.updated_at ?? orphan.raw.updatedAt ?? orphan.comment.createdAt),
    });
  }

  return threads;
}

function appendIssueReply(
  parent: CommentThread,
  comment: Comment,
  raw: Record<string, unknown>,
): void {
  parent.comments.push(comment);
  parent.updatedAt = String(raw.updated_at ?? raw.updatedAt ?? comment.createdAt);
}

export type { GitUserRef };
