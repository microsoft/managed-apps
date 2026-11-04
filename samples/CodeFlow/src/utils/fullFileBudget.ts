/**
 * How much of a file the diff viewer will expand around a change before it
 * stops and asks.
 *
 * "Full file" is the default scope, and for the ordinary file it is the right
 * one — reviewing a change with none of its surroundings is guesswork. But the
 * cost is paid per *line of the file*, not per line of the change, and it is
 * paid again on every re-render:
 *
 * | rendered            | rows | DOM nodes | first paint | re-render |
 * |---------------------|------|-----------|-------------|-----------|
 * | the hunks alone     |    4 |        95 |        6 ms |      3 ms |
 * | 2000-line file      | 2001 |    16 010 |      517 ms |    157 ms |
 * | ...with highlighting| 2001 |    88 005 |     2191 ms |   1170 ms |
 *
 * (measured in jsdom, which does no layout or paint, so a browser is worse.)
 *
 * Two multipliers compound. Expanding a four-line change to the whole file
 * multiplies the rows by five hundred, and syntax highlighting then multiplies
 * the nodes again — a span per token, about eighteen per cell. A second per
 * keystroke is not slow, it is broken, and it is what a reviewer opening a big
 * file actually sees.
 *
 * So past {@link MAX_FULL_FILE_LINES} the expansion waits for a second,
 * deliberate click. Nothing is taken away: the toggle still expands the file,
 * and the header says why it did not do it on its own. Large files still get
 * syntax highlighting when expanded: offscreen token spans are deferred so
 * colour does not multiply the whole file's DOM size.
 *
 * Where the budget sits is the reviewer's to move, though — see
 * `settings.fullFileLineLimit`. Someone who reviews long files all day and would
 * rather wait than click can set {@link NO_FULL_FILE_LINE_LIMIT} and never be
 * asked again; the default stands for everyone who hasn't formed an opinion.
 */

/**
 * Lines above which "Full file" waits to be asked twice.
 *
 * Set below the size the hang was first reported at (2000) rather than at it:
 * the reporter's file was where it became unmissable, not where it began.
 */
export const MAX_FULL_FILE_LINES = 1000;

/**
 * The limit that isn't one: expand every file, however long, without asking.
 *
 * Zero rather than `Infinity` because settings are stored as JSON, which has no
 * way to write an infinity — the same reason `refreshIntervalSeconds` spells
 * "never poll" as `0`.
 */
export const NO_FULL_FILE_LINE_LIMIT = 0;

/**
 * Count the lines in a string without allocating one array entry per line —
 * the point of this module is not to spend the budget measuring it.
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    lines += 1;
  }
  return lines;
}

/**
 * Whether expanding this file to its full length is too expensive to do
 * unprompted. Content we do not have cannot be over budget — that case is
 * "unavailable", which the header already reports separately.
 *
 * A limit of {@link NO_FULL_FILE_LINE_LIMIT} (or any other non-positive number,
 * so a corrupt stored setting fails open rather than holding every file back)
 * means the reviewer has asked never to be stopped.
 */
export function isOversizeForFullFile(
  content: string | undefined,
  limit: number = MAX_FULL_FILE_LINES,
): boolean {
  if (limit <= 0) return false;
  return content != null && countLines(content) > limit;
}
