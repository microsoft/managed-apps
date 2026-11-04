// THE APP'S ICON — a tiny Windows 95 window, hand-plotted.
//
// Same idiom as the pixel flame and wrench markers (components/hot-indicator,
// components/repair-indicator): flat-filled rects on a small integer grid with
// `shape-rendering: crispEdges`, straight out of the 95 system palette. No
// gradients, no rounded corners, no emoji glyph — every edge stays hard at any
// size, exactly like a 16-colour VGA icon.
//
// The artwork lives HERE, as data, so there is exactly ONE drawing:
//   * components/win95-window-icon.tsx renders it as React <rect> elements for
//     the app's own 95 title bar, and
//   * svgMarkup() below serialises the identical rects as the favicon fallback.
// The official app/browser icon is the pixel-perfect PNG export at
// public/task-manager-icon.png.
//
// Deliberately NOT a .tsx: with no JSX in it this module can be imported and
// checked on its own, which is how the favicon's data URL was verified.

/** One flat block of colour: [x, y, width, height] on the 16x16 grid. */
export type IconRect = [x: number, y: number, w: number, h: number];

export const ICON_SIZE = 16;

/**
 * The window, painted back to front. 16x16 is the classic small-icon grid, and
 * every coordinate is a whole pixel on it.
 *
 *   . black keyline all the way round — what makes the shape read at 14px
 *   . white top/left and grey bottom/right, the 95 raised bevel
 *   . #c0c0c0 face, then the navy title bar with a caption and a close box
 *   . white client area with two grey "lines of content"
 */
export const ICON_LAYERS: { fill: string; rects: IconRect[] }[] = [
  // Opaque base keeps hosts that do not composite transparent icons correctly
  // from changing the artwork.
  { fill: "#000000", rects: [[0, 0, 16, 16]] },
  // Outer keyline.
  {
    fill: "#000000",
    rects: [
      [0, 0, 16, 1],
      [0, 15, 16, 1],
      [0, 0, 1, 16],
      [15, 0, 1, 16],
    ],
  },
  // Raised bevel: highlight on the top and left edges...
  {
    fill: "#ffffff",
    rects: [
      [1, 1, 14, 1],
      [1, 1, 1, 14],
    ],
  },
  // ...shadow on the bottom and right (drawn after, so it owns both corners,
  // which is how a real 95 frame resolves them).
  {
    fill: "#808080",
    rects: [
      [1, 14, 14, 1],
      [14, 1, 1, 14],
    ],
  },
  // The window face.
  { fill: "#c0c0c0", rects: [[2, 2, 12, 12]] },
  // Title bar — the one thing that makes this unmistakably a 95 window.
  { fill: "#000080", rects: [[3, 3, 10, 3]] },
  // Caption text (left) and the close box (right), as white pixel runs.
  {
    fill: "#ffffff",
    rects: [
      [4, 4, 5, 1],
      [11, 4, 2, 1],
      // Client area below the title bar.
      [3, 7, 10, 6],
    ],
  },
  // Two lines of "content" in the client area.
  {
    fill: "#808080",
    rects: [
      [4, 9, 7, 1],
      [4, 11, 5, 1],
    ],
  },
];

/** Every rect in paint order — the shared source for both renderers. */
export function iconRects(): { fill: string; rect: IconRect }[] {
  return ICON_LAYERS.flatMap(({ fill, rects }) =>
    rects.map((rect) => ({ fill, rect })),
  );
}

/** The same drawing as a standalone SVG document (used for the favicon). */
export function svgMarkup(): string {
  const body = iconRects()
    .map(
      ({ fill, rect: [x, y, w, h] }) =>
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}"` +
    ` shape-rendering="crispEdges">${body}</svg>`
  );
}

/** The icon as a data: URL, ready for a <link rel="icon"> href. */
export function faviconHref(): string {
  return `data:image/svg+xml,${encodeURIComponent(svgMarkup())}`;
}

/**
 * Point the browser tab's icon at the same PNG registered as the app's
 * official icon, with the data URL as a no-network fallback.
 *
 * WHY THIS IS DONE IN JS. The usual place for a favicon is a
 * `<link rel="icon">` in index.html, or a file in `public/` referenced from it.
 * index.html links the PNG too, but some hosts rewrite or drop the document
 * head, and browsers only probe `/favicon.ico` at the ORIGIN root while a
 * deployed app is served under a path.
 *
 * So the link element is also ensured at runtime. It reuses an existing `link[rel~="icon"]` if the host page
 * ever adds one, rather than stacking duplicates. Vite's relative base points
 * the link at the public PNG wherever the app is mounted; the in-memory SVG
 * keeps the favicon available if that asset request is ever rejected.
 *
 * HONEST LIMIT: this sets the icon for the document it runs in. While the app
 * is shown inside the preview iframe, the browser tab belongs to the PARENT
 * page and shows the parent's icon — so no visible change there. It applies
 * when this document is the top-level page.
 */
export function applyFavicon(): void {
  if (typeof document === "undefined") return;
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  const link = existing ?? document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.onerror = () => {
    link.onerror = null;
    link.type = "image/svg+xml";
    link.href = faviconHref();
  };
  link.href = `${import.meta.env.BASE_URL}task-manager-icon.png`;
  if (!existing) document.head.appendChild(link);
}
