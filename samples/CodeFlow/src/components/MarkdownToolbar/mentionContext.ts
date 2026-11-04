import { createContext, useContext } from 'react';
import type { GitUserRef } from '../../types';

/**
 * Users offered by the comment editor's @mention autocomplete.
 *
 * `candidates` is the static, instantly-filterable pool (repo collaborators,
 * PR participants, and the current user) used for the empty-query default and
 * no-latency matching. `search`, when present, confirms a fully-typed handle
 * has repo access, so a collaborator beyond the preloaded pages still resolves
 * when typed in full — mirroring GitHub's web mention picker.
 */
export interface MentionSource {
  candidates: GitUserRef[];
  search?: (query: string) => Promise<GitUserRef[]>;
}

/**
 * Defaults to an empty pool with no live search so the {@link MarkdownToolbar}
 * works (without suggestions) outside of a `MentionCandidatesProvider` — e.g.
 * in tests.
 */
export const MentionContext = createContext<MentionSource>({ candidates: [] });

/** Read the mentionable-user source available to the current comment editor. */
export function useMentionSource(): MentionSource {
  return useContext(MentionContext);
}
