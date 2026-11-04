import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GitHubService } from '../../services/githubService';
import { useCodeFlow } from '../../state/useCodeFlow';
import type { GitUserRef } from '../../types';
import { MentionContext, type MentionSource } from './mentionContext';
import { mergeUsers } from './mentions';

/** A plausible GitHub handle: starts alphanumeric, then alnum/hyphen. */
const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Loads the set of users that can be @mentioned in comments for the currently
 * loaded PR and exposes them via {@link MentionContext}.
 *
 * The pool is everyone with access to the repository — direct collaborators and
 * org members who inherit access through a team — the same audience GitHub's
 * web mention picker offers, so you can tag someone who isn't on the PR yet:
 *  - `candidates` — an instant, local pool of the repo's collaborators, the
 *    current PR's participants, and the authenticated user (so you can always
 *    mention yourself), used for zero-latency prefix filtering.
 *  - `search` — a live resolver that confirms a fully-typed handle has repo
 *    access, so a collaborator beyond the preloaded pages still resolves when
 *    typed in full.
 */
export function MentionCandidatesProvider({ children }: { children: ReactNode }) {
  const { pr, reviewers, threads } = useCodeFlow();
  const owner = pr?.coordinates.owner;
  const name = pr?.coordinates.name;

  const [pool, setPool] = useState<GitUserRef[]>([]);
  // The repo the current `pool` was loaded for. Keeping the key alongside the
  // users means a stale pool is ignored on sight rather than being cleared by a
  // synchronous setState, which would cascade a render for a value we can
  // simply decline to use.
  const [poolKey, setPoolKey] = useState<string | null>(null);
  const repoKey = owner && name ? `${owner}/${name}` : null;

  useEffect(() => {
    let cancelled = false;
    const repo = owner && name ? { owner, name } : null;
    if (!repo) return;
    void (async () => {
      // The authenticated user is always mentionable — include them explicitly
      // so "mention myself" works even if they're beyond the collaborator pages.
      const [self, collaborators] = await Promise.all([
        GitHubService.getAuthenticatedUser(),
        GitHubService.listCollaborators(repo),
      ]);
      if (cancelled) return;
      setPool(mergeUsers(collaborators, self ? [self] : []));
      setPoolKey(`${repo.owner}/${repo.name}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  const source = useMemo<MentionSource>(() => {
    const participants: GitUserRef[] = [];
    if (pr?.author) participants.push(pr.author);
    for (const r of reviewers) participants.push(r.user);
    for (const t of threads) {
      for (const c of t.comments) participants.push(c.author);
    }
    // Only trust the pool if it was loaded for the repo we're showing now.
    const ownPool = repoKey != null && poolKey === repoKey ? pool : [];
    const candidates = mergeUsers(ownPool, participants);
    const repo = owner && name ? { owner, name } : null;
    return {
      candidates,
      search: repo
        ? async (query: string): Promise<GitUserRef[]> => {
            const term = query.trim();
            if (!LOGIN_RE.test(term)) return [];
            // Already offered from the local pool — no need to hit the network.
            if (candidates.some((u) => u.login.toLowerCase() === term.toLowerCase())) {
              return [];
            }
            const ok = await GitHubService.isCollaborator(repo, term);
            return ok ? [{ login: term }] : [];
          }
        : undefined,
    };
  }, [pool, poolKey, repoKey, pr, reviewers, threads, owner, name]);

  return <MentionContext.Provider value={source}>{children}</MentionContext.Provider>;
}
