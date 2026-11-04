/**
 * The lifecycle of a line-focus request — the thing that happens when a
 * reviewer clicks a cross-file search result.
 *
 * A request is raised by {@link useLineFocus.focusLine} and lives until it is
 * consumed. That second half is the part worth being careful about: a request
 * that is never retired outlives the navigation that raised it, so merely
 * opening its file again later would replay the jump, scrolling the reviewer
 * somewhere they never asked to go and possibly re-widening the view to get
 * there. Requests are therefore one-shot, and every path out of the viewer's
 * landing loop — landed, given up, overtaken, navigated away from — retires it.
 *
 * It lives here rather than inline in the provider so that the rule is stated
 * once, and so the viewer's integration tests can drive the genuine article
 * instead of a mock that cannot forget.
 */
import { useCallback, useRef } from 'react';
import type { CodeFlowState } from '../codeFlowContext';
import type { DiffSide } from '../../types';

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

export function useLineFocus(setState: SetState) {
  const seqRef = useRef(0);

  // Navigate to a search hit: open its file and ask the viewer to scroll the
  // line into view. The address is deliberately side + line rather than a row
  // key — see `lineFocusRequest`.
  const focusLine = useCallback((filename: string, side: DiffSide, line: number) => {
    const seq = ++seqRef.current;
    setState((s) => ({
      ...s,
      selectedFile: filename,
      selectedFolder: undefined,
      lineFocusRequest: { filename, side, line, seq },
    }));
  }, [setState]);

  const consumeLineFocus = useCallback((seq: number) => {
    setState((s) => (
      // A newer request is already in flight; this one has nothing left to
      // retire and must not clear its successor.
      s.lineFocusRequest?.seq !== seq ? s : { ...s, lineFocusRequest: undefined }
    ));
  }, [setState]);

  return { focusLine, consumeLineFocus };
}
