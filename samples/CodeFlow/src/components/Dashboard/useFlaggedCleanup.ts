import { useCallback, useState } from 'react';
import { GitHubService } from '../../services/githubService';
import { prKeyOf } from '../../utils/dashboardReview';
import { pruneFlaggedPrs, type FlaggedPr } from '../../utils/storage';

/**
 * On-demand cleanup for the Flagged list.
 *
 * The dashboard used to fetch every flagged PR's live status on load purely so
 * merged/closed ones could be hidden — one connector request per star, on an
 * uncapped list, every single render pass. Flagged rows render fine from the
 * title captured when they were starred, so that work now happens only when the
 * reviewer explicitly asks for it.
 *
 * Fetches fail open: a PR whose status can't be read is left flagged.
 */
export interface FlaggedCleanup {
  running: boolean;
  /** Number of flags removed by the last run, or undefined if it hasn't run. */
  removed?: number;
  run: () => void;
}

export function useFlaggedCleanup(flags: FlaggedPr[], onChange: () => void): FlaggedCleanup {
  const [running, setRunning] = useState(false);
  const [removed, setRemoved] = useState<number | undefined>(undefined);

  const run = useCallback(() => {
    if (running) return;
    setRunning(true);
    setRemoved(undefined);

    const work = async () => {
      const resolved = new Set<string>();
      // Sequential on purpose: a burst of parallel requests is exactly what got
      // this dashboard rate-limited. The list is short and this is user-initiated.
      for (const f of flags) {
        try {
          const pr = await GitHubService.getPullRequest({
            owner: f.owner,
            name: f.name,
            number: f.number,
          });
          if (pr.merged || pr.state !== 'open') resolved.add(prKeyOf(f));
        } catch {
          /* fail open — keep the flag */
        }
      }
      if (resolved.size > 0) {
        pruneFlaggedPrs((f) => resolved.has(prKeyOf(f)));
        onChange();
      }
      setRemoved(resolved.size);
      setRunning(false);
    };

    void work();
  }, [flags, onChange, running]);

  return { running, removed, run };
}
