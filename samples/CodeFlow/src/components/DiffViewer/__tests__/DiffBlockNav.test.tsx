import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiffBlockNav } from '../DiffBlockNav';
import type { DiffBlockNav as Nav } from '../useDiffBlockNav';

function makeNav(overrides: Partial<Nav> = {}): Nav {
  return {
    total: 4,
    ordinal: null,
    canPrev: true,
    canNext: true,
    next: vi.fn(),
    prev: vi.fn(),
    ...overrides,
  };
}

describe('DiffBlockNav', () => {
  it('shows a placeholder ordinal until the first jump', () => {
    render(<DiffBlockNav nav={makeNav()} />);
    expect(screen.getByText('–/4')).toBeTruthy();
  });

  it('shows the current position once navigating', () => {
    render(<DiffBlockNav nav={makeNav({ ordinal: 2 })} />);
    expect(screen.getByText('2/4')).toBeTruthy();
  });

  it('shows 0 when the file has no change blocks', () => {
    render(<DiffBlockNav nav={makeNav({ total: 0, canPrev: false, canNext: false })} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('disables the buttons when there is nowhere to go', () => {
    render(<DiffBlockNav nav={makeNav({ canPrev: false, canNext: false })} />);
    expect(screen.getByLabelText('Previous change').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Next change').hasAttribute('disabled')).toBe(true);
  });

  it('invokes prev/next on click', () => {
    const nav = makeNav();
    render(<DiffBlockNav nav={nav} />);
    screen.getByLabelText('Next change').click();
    screen.getByLabelText('Previous change').click();
    expect(nav.next).toHaveBeenCalledTimes(1);
    expect(nav.prev).toHaveBeenCalledTimes(1);
  });
});
