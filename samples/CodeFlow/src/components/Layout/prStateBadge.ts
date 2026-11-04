import type { PrSummary } from '../../types';

/** The label and modifier class for the state chip beside the PR title. */
export interface PrStateBadge {
  label: string;
  /** BEM modifier, e.g. `draft` — the caller prefixes it with `pr-state--`. */
  modifier: 'merged' | 'closed' | 'draft' | 'open';
}

/**
 * Describe a pull request's state for the topbar chip.
 *
 * Split out of the JSX because the label and the colour have to agree, and
 * until now they didn't: the chip read "Draft" while wearing the green `open`
 * modifier, so a draft looked exactly like a pull request that was ready for
 * review — the one thing the chip exists to distinguish.
 *
 * Order matters. Merged wins over everything (a merged pull request is never a
 * draft), and closed wins over draft: a closed draft is closed, and saying
 * "Draft" would bury the fact that nobody can merge it.
 */
export function prStateBadge(pr: Pick<PrSummary, 'merged' | 'draft' | 'state'>): PrStateBadge {
  if (pr.merged) return { label: 'Merged', modifier: 'merged' };
  if (pr.state === 'closed') return { label: 'Closed', modifier: 'closed' };
  if (pr.draft) return { label: 'Draft', modifier: 'draft' };
  return { label: 'Open', modifier: 'open' };
}
