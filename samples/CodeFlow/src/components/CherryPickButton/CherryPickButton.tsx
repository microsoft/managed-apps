import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { GitHubService } from '../../services/githubService';
import {
  cherryPickPullRequest,
  cherryPickTargets,
  evaluateCherryPickGate,
  previewCherryPick,
  suggestCherryPickBranch,
  validateBranchName,
  type CherryPickPreview,
  type CherryPickResult,
} from '../../services/cherryPick';

/**
 * Take this pull request's changes to another branch.
 *
 * The shape deliberately echoes the merge button — a small topbar control that
 * opens a confirmation panel rather than acting on the first click — because
 * this also writes to the repository. It differs in who may press it (anyone;
 * see `evaluateCherryPickGate`) and in being undoable: everything it creates is
 * a new branch, and optionally a new pull request.
 *
 * The panel does its own reading rather than going through the provider. A
 * cherry-pick changes nothing about the pull request on screen, so there is no
 * state for the provider to fold in and nothing for it to own.
 */
export function CherryPickButton() {
  const { pr } = useCodeFlow();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchEdited, setBranchEdited] = useState(false);
  const [openPr, setOpenPr] = useState(true);
  /**
   * The last preview and the target it belongs to.
   *
   * Storing the target alongside it is what keeps a stale warning off the
   * screen without clearing state from inside an effect: a preview whose
   * target no longer matches simply isn't the current one, and the panel reads
   * as still working.
   */
  const [previewFor, setPreviewFor] = useState<{
    target: string;
    preview?: CherryPickPreview;
  }>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CherryPickResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Branch list, read once per opening. Cheap enough not to cache, and a stale
  // list is exactly the thing that makes a release branch impossible to find.
  useEffect(() => {
    if (!open || !pr) return;
    let cancelled = false;
    void GitHubService.listBranches({
      owner: pr.coordinates.owner,
      name: pr.coordinates.name,
    }).then((names) => {
      if (!cancelled) setBranches(names);
    });
    return () => {
      cancelled = true;
    };
  }, [open, pr]);

  const targets = useMemo(() => cherryPickTargets(branches, pr), [branches, pr]);

  // Re-read what the cherry-pick would do whenever the target changes, so the
  // divergence warning belongs to the branch actually selected.
  useEffect(() => {
    if (!open || !pr || !target) return;
    let cancelled = false;
    void previewCherryPick(pr, target)
      .then((p) => {
        if (!cancelled) setPreviewFor({ target, preview: p });
      })
      .catch(() => {
        // Nothing to preview is not a reason to refuse: the cherry-pick works
        // it out again for itself, and will fail loudly there if it must.
        if (!cancelled) setPreviewFor({ target });
      });
    return () => {
      cancelled = true;
    };
  }, [open, pr, target]);

  const preview = previewFor?.target === target ? previewFor.preview : undefined;
  const previewing = Boolean(target) && previewFor?.target !== target;

  const chooseTarget = useCallback(
    (value: string) => {
      setTarget(value);
      setError(undefined);
      // Keep the suggested branch name in step with the target until the
      // reviewer types their own, at which point it is theirs to manage.
      if (pr && !branchEdited) setBranchName(suggestCherryPickBranch(pr, value));
    },
    [pr, branchEdited],
  );

  const reset = () => {
    setOpen(false);
    setTarget('');
    setBranchName('');
    setBranchEdited(false);
    setPreviewFor(undefined);
    setError(undefined);
  };

  const gate = evaluateCherryPickGate(pr);
  if (!gate.visible || !pr) return null;

  const nameError = branchName ? validateBranchName(branchName) : undefined;
  const touched = preview ? preview.plan.writes.length + preview.plan.deletes.length : 0;
  const canRun = Boolean(target) && Boolean(branchName) && !nameError && !busy && !previewing;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const outcome = await cherryPickPullRequest({
        pr,
        targetBranch: target,
        newBranch: branchName.trim(),
        openPullRequest: openPr,
        preview,
      });
      if (!alive.current) return;
      setResult(outcome);
      reset();
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : 'The cherry-pick failed.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn btn--sm btn--cherry"
        disabled={!gate.ready}
        onClick={() => (open ? reset() : setOpen(true))}
        title={gate.reason ?? 'Apply these changes to another branch'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        🍒 Cherry-pick
      </button>
      {result && (
        <div className="cherry-result" role="status">
          <p className="cherry-result__lead">
            Cherry-picked onto{' '}
            <a href={result.branchUrl} target="_blank" rel="noreferrer">
              {result.branch}
            </a>
            {result.pullRequestOpened ? ' and opened a pull request.' : '.'}
          </p>
          <p className="cherry-result__detail">
            {result.written.length} file{result.written.length === 1 ? '' : 's'} written
            {result.deleted.length > 0 ? `, ${result.deleted.length} deleted` : ''}
            {result.unchanged.length > 0
              ? `, ${result.unchanged.length} already up to date`
              : ''}
            .
          </p>
          {result.merged.length > 0 && (
            <p className="cherry-result__detail">
              {result.merged.length} file{result.merged.length === 1 ? ' was' : 's were'} merged
              with changes already on that branch.
            </p>
          )}
          <button className="btn btn--sm" onClick={() => setResult(undefined)}>
            Dismiss
          </button>
        </div>
      )}
      {open && (
        <div className="cherry-prompt" role="dialog" aria-label="Cherry-pick pull request">
          <p className="cherry-prompt__lead">
            Apply the changes in <strong>{pr.headRef}</strong> to another branch.
          </p>
          <label className="cherry-prompt__field">
            <span className="cherry-prompt__label">Target branch</span>
            <input
              className="cherry-prompt__input"
              list="cherry-pick-branches"
              value={target}
              placeholder="release/1.0"
              onChange={(e) => chooseTarget(e.target.value)}
              autoFocus
            />
            <datalist id="cherry-pick-branches">
              {targets.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className="cherry-prompt__field">
            <span className="cherry-prompt__label">New branch</span>
            <input
              className="cherry-prompt__input"
              value={branchName}
              placeholder="cherry-pick/…"
              onChange={(e) => {
                setBranchEdited(true);
                setBranchName(e.target.value);
              }}
            />
          </label>
          {nameError && (
            <p className="cherry-prompt__error" role="alert">
              {nameError}
            </p>
          )}
          <label className="cherry-prompt__check">
            <input type="checkbox" checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} />
            <span>Open a pull request into {target || 'the target branch'}</span>
          </label>
          {previewing && <p className="cherry-prompt__note">Working out what would change…</p>}
          {preview && (
            <p className="cherry-prompt__note">
              {touched} file{touched === 1 ? '' : 's'} would be cherry-picked.
            </p>
          )}
          {preview?.warning && (
            <p className="cherry-prompt__note cherry-prompt__note--merge" role="status">
              {preview.warning}
            </p>
          )}
          {error && (
            <p className="cherry-prompt__error" role="alert">
              {error}
            </p>
          )}
          <p className="cherry-prompt__note">
            This uses the pull request's recorded head commit, even after it is merged or its
            source branch is deleted. Changes on the target branch are merged; conflicts stop
            the cherry-pick. Nothing about this pull request changes.
          </p>
          <div className="cherry-prompt__actions">
            <button className="btn btn--sm btn--cherry" disabled={!canRun} onClick={() => void run()}>
              {busy ? '⏳' : '🍒'} Cherry-pick pull request
            </button>
            <button className="btn btn--sm" onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
