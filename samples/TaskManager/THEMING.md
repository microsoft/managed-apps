# Theming

Task Manager has two style layers:

1. **`src/styles/win95.css`** — the Windows 95 skin: grey chrome, two-ring bevels, gradient title
   bars, classic tabs, sunken fields and 95-era scrollbars. Almost everything you see comes from its
   `w95-*` classes (`w95-window`, `w95-titlebar`, `w95-btn`, `w95-tab`, `w95-panel`, `w95-in`, …).
2. **`src/index.css`** — Tailwind v4 plus the shadcn/ui design tokens (`--primary`, `--accent`,
   `--ring`, `--chart-*`, `--radius`, …) used by the vendored components in `src/components/ui/`.

## Changing the 95 look

- Title bar gradients read two custom properties, `--w95-title-a` and `--w95-title-b`. Override them
  on any element to recolour one window (the retrospective columns do this inline).
- Work-item state colours live in `STATE_META` in `src/lib/work-items-data.ts`; backlog category
  colours are the `AREA_PALETTE` entries in the same file (assigned to `VITE_ADO_AREAS` in order).
- Tag markers (chips, flame, wrench) are defined in `MARKER_STYLES` in `src/lib/tag-config.ts`.
- Animations intentionally ignore `prefers-reduced-motion` (see the note in `win95.css`). If your
  audience needs reduced motion, change `reducedMotion` in `src/components/app-shell.tsx` and add a
  `@media (prefers-reduced-motion: reduce)` block to `win95.css`.

## Retheming the shadcn/ui tokens

Edit `src/index.css` and set five values per block — `--primary`, `--primary-foreground`,
`--accent`, `--accent-foreground` and `--ring` — each as `oklch(...)`. Update all three blocks so
light, explicit dark and OS-dark users all match:

- `:root { … }` — light theme (use the `:root` column below),
- `.dark { … }` — explicit dark class (use the `.dark` column),
- `@media (prefers-color-scheme: dark) { :root:not(.light) { … } }` — OS dark mode (same values as `.dark`).

| Hue | `:root` (primary / fg / accent / accent-fg / ring) | `.dark` |
|---|---|---|
| Indigo | `.52 .16 265` / `.99 0 0` / `.95 .03 265` / `.38 .13 265` / `.52 .16 265` | `.62 .16 265` / `.15 .01 265` / `.26 .05 265` / `.9 .03 265` / `.62 .16 265` |
| Teal | `.56 .11 195` / `.99 0 0` / `.95 .03 195` / `.38 .09 195` / `.56 .11 195` | `.64 .11 195` / `.15 .01 195` / `.26 .04 195` / `.9 .03 195` / `.64 .11 195` |
| Violet | `.52 .18 300` / `.99 0 0` / `.95 .04 300` / `.4 .14 300` / `.52 .18 300` | `.62 .18 300` / `.15 .01 300` / `.27 .06 300` / `.9 .04 300` / `.62 .18 300` |
| Green | `.56 .13 150` / `.99 0 0` / `.95 .04 150` / `.38 .1 150` / `.56 .13 150` | `.64 .13 150` / `.15 .01 150` / `.26 .05 150` / `.9 .04 150` / `.64 .13 150` |
| Amber | `.7 .15 70` / `.2 .04 70` / `.96 .05 70` / `.42 .12 70` / `.7 .15 70` | `.76 .15 70` / `.18 .03 70` / `.3 .06 70` / `.92 .05 70` / `.76 .15 70` |
| Rose | `.56 .17 25` / `.99 0 0` / `.96 .04 25` / `.4 .14 25` / `.56 .17 25` | `.64 .17 25` / `.15 .01 25` / `.27 .06 25` / `.9 .04 25` / `.64 .17 25` |

Charts: set `--chart-1..5` (in every block) to colours derived from your primary hue. Radius: tune
`--radius`.

In JSX, prefer semantic utilities (`bg-primary`, `text-muted-foreground`, `border-border`) over raw
colour values. Fonts are bundled (Geist via `@fontsource-variable/geist`); don't add CDN font imports,
which the app's content security policy may block.
