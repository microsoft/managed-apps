/**
 * Layout preferences that are deliberately device-local: pane widths, split
 * ratios and per-PR panel state. They live in the `ui` key/value namespace of
 * app storage.
 *
 * Anything a reviewer would expect to follow them between machines belongs in
 * the settings document (`settings/settings`) instead.
 */

import { z } from 'zod';
import { appStorage } from '../storage';

function readNumber(key: string): number | undefined {
  try {
    return appStorage().ui.get(key, z.number());
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    appStorage().ui.set(key, value);
  } catch {
    /* layout preferences are a nicety; never let them break the UI */
  }
}

export const SPLIT_KEY = 'splitRatio';

export function loadSplitRatio(): number {
  const n = readNumber(SPLIT_KEY);
  return n !== undefined && n >= 20 && n <= 80 ? n : 50;
}

export function saveSplitRatio(ratio: number): void {
  write(SPLIT_KEY, Math.round(ratio));
}

export const SIDEBAR_KEY = 'sidebarWidth';
export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 640;

export function loadSidebarWidth(): number {
  const n = readNumber(SIDEBAR_KEY);
  return n !== undefined && n >= MIN_SIDEBAR_WIDTH && n <= MAX_SIDEBAR_WIDTH ? n : DEFAULT_SIDEBAR_WIDTH;
}

export function saveSidebarWidth(width: number): void {
  write(SIDEBAR_KEY, Math.round(width));
}

export const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';

/**
 * Whether the file explorer starts collapsed. It is open unless this reviewer
 * has collapsed it on this screen, so a first run always shows the file tree.
 */
export function loadSidebarCollapsed(): boolean {
  try {
    return appStorage().ui.get(SIDEBAR_COLLAPSED_KEY, z.boolean()) ?? false;
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  write(SIDEBAR_COLLAPSED_KEY, collapsed);
}

export const SUMMARY_HEIGHT_KEY = 'summaryHeight';
export const DEFAULT_SUMMARY_HEIGHT = 240;
export const MIN_SUMMARY_HEIGHT = 120;
export const MAX_SUMMARY_HEIGHT = 900;
/** How much of the window the diff keeps, however far the summary is dragged. */
export const MIN_WORKAREA_HEIGHT = 160;

/**
 * Hold a summary height inside what the layout can honour. The window is the
 * real ceiling — a panel taller than the screen would squeeze the diff out
 * entirely — so `viewport` tightens the bound when it is known.
 */
export function clampSummaryHeight(height: number, viewport?: number): number {
  const ceiling =
    typeof viewport === 'number' && viewport > 0
      ? Math.min(MAX_SUMMARY_HEIGHT, Math.max(MIN_SUMMARY_HEIGHT, viewport - MIN_WORKAREA_HEIGHT))
      : MAX_SUMMARY_HEIGHT;
  return Math.min(ceiling, Math.max(MIN_SUMMARY_HEIGHT, height));
}

/** The height the comment summary opens at, as last dragged on this screen. */
export function loadSummaryHeight(): number {
  const n = readNumber(SUMMARY_HEIGHT_KEY);
  return n !== undefined && Number.isFinite(n) && n >= MIN_SUMMARY_HEIGHT && n <= MAX_SUMMARY_HEIGHT
    ? n
    : DEFAULT_SUMMARY_HEIGHT;
}

export function saveSummaryHeight(height: number): void {
  write(SUMMARY_HEIGHT_KEY, Math.round(clampSummaryHeight(height)));
}

export const SUMMARY_KEY_PREFIX = 'summaryOpen:';

/**
 * Whether the comment summary starts open for a PR. `fallback` carries the
 * reviewer's global preference; the per-PR key only overrides it once they have
 * explicitly collapsed or expanded the panel on that PR.
 */
export function loadSummaryOpen(prKey: string | undefined, fallback = true): boolean {
  if (!prKey) return fallback;
  try {
    return appStorage().ui.get(SUMMARY_KEY_PREFIX + prKey, z.boolean()) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveSummaryOpen(prKey: string, open: boolean): void {
  write(SUMMARY_KEY_PREFIX + prKey, open);
}

export const DASHBOARD_SECTIONS_KEY = 'dashboardSections';

/** Which dashboard sections the reviewer has collapsed. */
export function loadCollapsedSections(): Record<string, boolean> {
  try {
    return appStorage().ui.get(DASHBOARD_SECTIONS_KEY, z.record(z.string(), z.boolean())) ?? {};
  } catch {
    return {};
  }
}

export function saveCollapsedSections(sections: Record<string, boolean>): void {
  write(DASHBOARD_SECTIONS_KEY, sections);
}
