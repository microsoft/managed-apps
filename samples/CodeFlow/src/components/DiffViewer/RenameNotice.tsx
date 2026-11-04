import type { RenameInfo } from '../../utils/renameInfo';

/**
 * Says out loud that a file moved, because a pure move is otherwise invisible.
 *
 * The diff for a move is empty, the counts are +0/−0 and the file list shows
 * the same basename it did before, so without this banner the reviewer has no
 * way to tell the difference between "this file travelled to another folder"
 * and "this file failed to load". Both paths are printed in full: the folder a
 * file came from is the whole point of the change, and it is exactly the part
 * a truncated path in the header clips away.
 */
export function RenameNotice({ info }: { info: RenameInfo | undefined }) {
  if (!info) return null;

  return (
    <div className="diff__renamenotice" role="status">
      <span className="diff__renamenotice-icon" aria-hidden="true">
        ↪
      </span>
      <span className="diff__renamenotice-text">
        <strong>{info.verb}</strong>{' '}
        {info.pathOnly
          ? '— only the file path changed. The contents are identical.'
          : '— the file path changed, and so did its contents.'}
        <span className="diff__renamenotice-paths">
          <bdi className="diff__renamenotice-path diff__renamenotice-path--from">{info.from}</bdi>
          <span className="diff__renamenotice-arrow" aria-hidden="true">
            →
          </span>
          {/* The arrow carries the whole meaning of the pair, and a screen
              reader would skip it, so spell it out for one. */}
          <span className="u-sronly"> moved to </span>
          <bdi className="diff__renamenotice-path">{info.to}</bdi>
        </span>
      </span>
    </div>
  );
}
