// How many COLUMNS a responsive multi-column work-item list is currently
// showing, in JavaScript.
//
// The layouts themselves are plain CSS (Tailwind `grid-cols-*` at breakpoints)
// — this hook does NOT lay anything out. It exists for the one thing CSS can't
// tell the components: zebra striping. Striping by list index (`i % 2`) reads
// as a diagonal checkerboard once a list wraps into columns, so the multi-column
// lists stripe by ROW instead (`floor(i / columns) % 2`), which needs the column
// count that the media queries picked.
//
// The steps MUST mirror the Tailwind breakpoints used on the grid, or the
// stripes drift out of step with the layout.

import { useEffect, useState } from "react";

/** `{ minWidth, columns }`, largest breakpoint LAST — the same order as CSS. */
export type ColumnStep = { minWidth: number; columns: number };

function columnsFor(steps: ColumnStep[], width: number): number {
  let columns = 1;
  for (const step of steps) {
    if (width >= step.minWidth) columns = step.columns;
  }
  return columns;
}

export function useResponsiveColumns(steps: ColumnStep[]): number {
  const [columns, setColumns] = useState(() =>
    typeof window === "undefined"
      ? 1
      : columnsFor(steps, window.innerWidth),
  );

  useEffect(() => {
    const read = () => setColumns(columnsFor(steps, window.innerWidth));
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
    // The caller passes a literal array; depend on its VALUES, not identity,
    // so a fresh array each render doesn't re-subscribe on every render.
  }, [steps.map((s) => `${s.minWidth}:${s.columns}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return columns;
}
