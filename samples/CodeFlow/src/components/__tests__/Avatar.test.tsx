import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from '../Avatar';

describe('Avatar', () => {
  it('renders initials, never a remote image (CSP blocks avatar hosts)', () => {
    const { container } = render(
      <Avatar user={{ login: 'octocat', name: 'Mona Octocat', avatarUrl: 'https://example.com/a.png' }} />,
    );
    expect(container.querySelector('img')).toBeNull();
    const span = container.querySelector('span.avatar--initials');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe('MO');
  });

  it('applies a deterministic background color derived from the login', () => {
    const first = render(<Avatar user={{ login: 'octocat', name: 'Mona Octocat' }} />);
    const firstBg = (first.container.querySelector('span.avatar--initials') as HTMLElement).style
      .background;
    // jsdom normalizes hsl() to rgb(), so assert on determinism rather than the literal string.
    expect(firstBg).not.toBe('');

    const second = render(<Avatar user={{ login: 'octocat', name: 'Someone Else' }} />);
    const secondBg = (second.container.querySelector('span.avatar--initials') as HTMLElement).style
      .background;
    expect(secondBg).toBe(firstBg);

    const other = render(<Avatar user={{ login: 'hubot' }} />);
    const otherBg = (other.container.querySelector('span.avatar--initials') as HTMLElement).style
      .background;
    expect(otherBg).not.toBe(firstBg);
  });

  it('falls back gracefully when no user is provided', () => {
    const { container } = render(<Avatar />);
    const span = container.querySelector('span.avatar--initials');
    expect(span?.textContent).toBe('UN');
  });
});
