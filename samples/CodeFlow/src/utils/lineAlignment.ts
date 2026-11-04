/** Bound the quadratic LCS allocation and work on the UI thread. */
const MAX_CELLS = 2_000_000;

/** Map unchanged lines in `anc` to their positions in `side`, or reject an oversized pair. */
export function alignLines(
  anc: readonly string[],
  side: readonly string[],
): { matched: boolean[]; pos: Int32Array } | null {
  const n = anc.length;
  const m = side.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        anc[i] === side[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const matched = new Array<boolean>(n).fill(false);
  const pos = new Int32Array(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (anc[i] === side[j]) {
      matched[i] = true;
      pos[i] = j;
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { matched, pos };
}
