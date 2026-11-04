import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { RefreshTimer } from '../RefreshTimer';
import { formatCountdown } from '../formatCountdown';
import {
  resetSettingsStoreForTests,
  updateSettings,
} from '../../../settings/settingsStore';

const refreshNow = vi.fn(async () => {});
const ctx: { lastRefreshAt?: number; actions: { refreshNow: () => Promise<void> } } = {
  lastRefreshAt: undefined,
  actions: { refreshNow },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ctx,
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsStoreForTests();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  ctx.lastRefreshAt = Date.now();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatCountdown', () => {
  it('shows seconds under a minute', () => {
    expect(formatCountdown(0)).toBe('0s');
    expect(formatCountdown(9.4)).toBe('9s');
    expect(formatCountdown(59)).toBe('59s');
  });

  it('shows m:ss from a minute up', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(125)).toBe('2:05');
  });
});

describe('RefreshTimer', () => {
  it('counts down to the next automatic refresh', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    render(<RefreshTimer />);

    expect(screen.getByRole('button', { name: 'Refresh now' })).toHaveTextContent('30s');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByRole('button', { name: 'Refresh now' })).toHaveTextContent('25s');
  });

  it('refreshes on click', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    render(<RefreshTimer />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));

    await waitFor(() => expect(refreshNow).toHaveBeenCalledTimes(1));
  });

  it('falls back to a plain refresh button when polling is off', () => {
    updateSettings({ refreshIntervalSeconds: 0 });
    render(<RefreshTimer />);

    const btn = screen.getByRole('button', { name: 'Refresh now' });
    expect(btn).toHaveTextContent('Refresh');
    expect(btn.title).toMatch(/Auto-refresh is off/);
  });
});
