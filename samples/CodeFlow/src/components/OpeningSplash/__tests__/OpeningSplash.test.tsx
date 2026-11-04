import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpeningSplash } from '../OpeningSplash';
import { describeSplashDetail, describeSplashTarget } from '../describeTarget';
import type { DeepLinkTarget } from '../../../utils/deepLink';

const base: DeepLinkTarget = { owner: 'octo-org', repo: 'octo-repo', number: 123 };

describe('describeSplashTarget', () => {
  it('formats owner/repo#number', () => {
    expect(describeSplashTarget(base)).toBe('octo-org/octo-repo#123');
  });
});

describe('describeSplashDetail', () => {
  it('falls back to a generic message for a PR-only link', () => {
    expect(describeSplashDetail(base)).toBe('Fetching pull request details…');
  });

  it('names the file, using only the basename', () => {
    expect(describeSplashDetail({ ...base, file: 'src/deep/nested/Thing.ts' })).toBe(
      'Jumping to Thing.ts',
    );
  });

  it('mentions the comment when the link targets one inside a file', () => {
    expect(describeSplashDetail({ ...base, file: 'src/Thing.ts', commentId: 'PRRT_1' })).toBe(
      'Jumping to a comment in Thing.ts',
    );
  });

  it('handles a bare comment link', () => {
    expect(describeSplashDetail({ ...base, commentId: 'PRRT_1' })).toBe(
      'Jumping to a comment',
    );
  });
});

describe('OpeningSplash', () => {
  it('names the pull request being opened', () => {
    render(<OpeningSplash target={base} />);
    expect(screen.getByText('Opening pull request')).toBeTruthy();
    expect(screen.getByText('octo-org/octo-repo#123')).toBeTruthy();
  });

  it('announces itself to assistive tech', () => {
    render(<OpeningSplash target={base} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows a generic message when there is no target (player redirect)', () => {
    render(<OpeningSplash target={null} />);
    expect(screen.getByText('Opening CodeFlow…')).toBeTruthy();
    expect(screen.getByText('Taking you to the app…')).toBeTruthy();
  });

  it('reassures the reviewer once the load drags on', async () => {
    vi.useFakeTimers();
    try {
      render(<OpeningSplash target={base} />);
      expect(screen.queryByText(/Still working/)).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.getByText(/Still working/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
