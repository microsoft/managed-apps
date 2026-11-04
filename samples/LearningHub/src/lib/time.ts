import { useSyncExternalStore } from 'react';
import { config } from '../config';

/** All session dates and times are in the series time zone (VITE_SERIES_TIME_ZONE). */
export const SERIES_ZONE = config.timeZone;

const zonedParts = new Intl.DateTimeFormat('en-US', {
  timeZone: SERIES_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partsOf(ts: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of zonedParts.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Calendar date of an instant in the series time zone, as yyyy-mm-dd. */
export function seriesDateKey(date: Date): string {
  const p = partsOf(date.getTime());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function zoneOffsetMs(ts: number): number {
  const p = partsOf(ts);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** The instant for a wall-clock time (series time zone) on a yyyy-mm-dd date. */
export function seriesWallTime(key: string, hhmm: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - zoneOffsetMs(guess);
  const second = guess - zoneOffsetMs(first);
  return new Date(second);
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function keyToUtcNoon(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(key: string, days: number): string {
  const date = keyToUtcNoon(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayOf(key: string): number {
  return keyToUtcNoon(key).getUTCDay();
}

/** "Thursday" for 4 (0 = Sunday). */
export function weekdayName(weekday: number): string {
  // 2023-01-01 was a Sunday.
  return formatKey(addDays('2023-01-01', weekday), { weekday: 'long' });
}

function formatKey(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(keyToUtcNoon(key));
}

/** Thursday, October 15, 2026 */
export function formatLongDate(key: string): string {
  return formatKey(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** Thu, Oct 15, 2026 */
export function formatMediumDate(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Thu, Oct 15 */
export function formatWeekdayDate(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Oct 15, 2026 */
export function formatDate(key: string): string {
  return formatKey(key, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonthShort(key: string): string {
  return formatKey(key, { month: 'short' });
}

export function formatDay(key: string): string {
  return formatKey(key, { day: 'numeric' });
}

export function formatYear(key: string): string {
  return formatKey(key, { year: 'numeric' });
}

function formatClock(hhmm: string): { time: string; period: string } {
  const [h, m] = hhmm.split(':').map(Number);
  return { time: `${h % 12 || 12}:${pad(m)}`, period: h < 12 ? 'AM' : 'PM' };
}

/** Short name of the series time zone, e.g. "PDT" or "GMT+1". */
export function zoneLabel(at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: SERIES_ZONE, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? SERIES_ZONE;
}

const ZONE = zoneLabel();

/** 9:05–10:00 AM PDT */
export function formatTimeRange(start: string, end: string): string {
  const a = formatClock(start);
  const b = formatClock(end);
  return a.period === b.period
    ? `${a.time}–${b.time} ${b.period} ${ZONE}`
    : `${a.time} ${a.period}–${b.time} ${b.period} ${ZONE}`;
}

/** Whole days from `from` to `to` (both yyyy-mm-dd). */
export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtcNoon(to).getTime() - keyToUtcNoon(from).getTime()) / 86_400_000);
}

/** Today, Yesterday, Last Thursday, 2 weeks ago, else Aug 13 (with the year if it differs). */
export function formatRelativeDay(key: string, today: string): string {
  const diff = daysBetween(key, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff <= 7) return `Last ${formatKey(key, { weekday: 'long' })}`;
  if (diff > 7 && diff < 28) {
    const weeks = Math.floor(diff / 7);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  }
  return key.slice(0, 4) === today.slice(0, 4)
    ? formatKey(key, { month: 'short', day: 'numeric' })
    : formatKey(key, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Today, Tomorrow, This Thursday, Next Thursday, else Oct 29 (for upcoming dates). */
export function formatRelativeUpcoming(key: string, today: string): string {
  const diff = daysBetween(today, key);
  const weekday = formatKey(key, { weekday: 'long' });
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return `This ${weekday}`;
  if (diff >= 7 && diff < 14) return `Next ${weekday}`;
  return key.slice(0, 4) === today.slice(0, 4)
    ? formatKey(key, { month: 'short', day: 'numeric' })
    : formatKey(key, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** 9:05 AM PDT */
export function formatStartTime(start: string): string {
  const { time, period } = formatClock(start);
  return `${time} ${period} ${ZONE}`;
}

function durationParts(seconds: number): { hours: number; minutes: number } {
  const total = Math.max(1, Math.round(seconds / 60));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** 52 min · 1 h · 1 h 5 min */
export function formatDuration(seconds: number): string {
  const { hours, minutes } = durationParts(seconds);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** 52 minutes · 1 hour 5 minutes (for screen readers) */
export function formatDurationLong(seconds: number): string {
  const { hours, minutes } = durationParts(seconds);
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

/** Formats an ISO instant as a calendar date in the series time zone. */
export function formatInstantDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : formatDate(seriesDateKey(date));
}

let nowSnapshot = new Date();
const nowListeners = new Set<() => void>();
let nowTimer: number | undefined;

function subscribeNow(listener: () => void): () => void {
  if (nowListeners.size === 0) {
    nowSnapshot = new Date();
    nowTimer = window.setInterval(() => {
      nowSnapshot = new Date();
      nowListeners.forEach((fn) => fn());
    }, 60_000);
  }
  nowListeners.add(listener);
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer !== undefined) {
      window.clearInterval(nowTimer);
      nowTimer = undefined;
    }
  };
}

function getNow(): Date {
  return nowSnapshot;
}

/** Current time, refreshed every minute; shared by all subscribers. */
export function useNow(): Date {
  return useSyncExternalStore(subscribeNow, getNow);
}
