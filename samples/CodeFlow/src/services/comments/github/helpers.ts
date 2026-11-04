/**
 * Small helpers shared by the GitHub comment modules.
 */

/** Coordinates of a pull request as the GraphQL API addresses it. */
export interface PrCoords {
  owner: string;
  repo: string;
  pullNumber: number;
}

/** Parse a prKey (`owner/repo#number`) back into its parts. */
export function parsePrKey(prKey: string): PrCoords {
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(prKey);
  if (!match) throw new Error(`Invalid prKey: ${prKey}`);
  return { owner: match[1], repo: match[2], pullNumber: Number(match[3]) };
}

/** `…#discussion_r1001` / `…#issuecomment-2002` → the numeric id. */
const HTML_URL_ID_RE = /[#_-]r?(\d+)$/;

/**
 * The numeric database id of a comment, whichever shape it arrives in.
 *
 * GraphQL nodes carry it as `databaseId` (their `id` is a node id), plain
 * objects may carry it as a numeric `id`, and failing both it is the numeric
 * tail of the comment's permalink. Deep links and "open on GitHub" anchors are
 * built from this id.
 *
 * Node ids (`PRRC_…`) are deliberately not accepted: they are a different id
 * space, and treating one as a database id would silently pair up the wrong
 * comments rather than simply failing to find a match.
 */
export function deriveCommentId(raw: Record<string, unknown>): string | undefined {
  for (const value of [raw.id, raw.databaseId]) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  }
  for (const value of [raw.html_url, raw.url]) {
    if (typeof value !== 'string') continue;
    const m = HTML_URL_ID_RE.exec(value);
    if (m) return m[1];
  }
  return undefined;
}

/** True for a GraphQL global node id (`PRRT_…`, `PRRC_…`, `IC_…`), never a database id. */
export function isNodeId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) && !/^\d+$/.test(id);
}
