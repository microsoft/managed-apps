import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ChecksPill } from '../ChecksPill';
import type { ChecksSummary, PrCheck } from '../../../types';

const refreshChecks = vi.fn(async () => {});

let checks: ChecksSummary | undefined;
let checksLoading = false;

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ({
    checks,
    checksLoading,
    pr: {
      coordinates: { owner: 'octo-org', name: 'octo-repo', number: 123 },
      htmlUrl: 'https://github.com/octo-org/octo-repo/pull/123',
    },
    actions: { refreshChecks },
  }),
}));

function check(over: Partial<PrCheck> = {}): PrCheck {
  return {
    id: '1',
    name: 'Build',
    outcome: 'success',
    rawState: 'SUCCESS',
    kind: 'check',
    
    isRequired: true,
    ...over,
  };
}

function summary(list: PrCheck[]): ChecksSummary {
  return {
    checks: list,
    sha: 'abc1234def',
    total: list.length,
    passed: list.filter((c) => c.outcome === 'success' || c.outcome === 'neutral').length,
    failed: list.filter((c) => c.outcome === 'failure').length,
    pending: list.filter((c) => c.outcome === 'pending').length,
  };
}

beforeEach(() => {
  refreshChecks.mockClear();
  checksLoading = false;
  checks = undefined;
});

describe('ChecksPill', () => {
  it('stays out of the way when the PR has no checks', () => {
    checks = summary([]);
    const { container } = render(<ChecksPill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing at all when checks could not be read', () => {
    const { container } = render(<ChecksPill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a placeholder while the first read is in flight', () => {
    checksLoading = true;
    render(<ChecksPill />);
    expect(screen.getByText('Checks…')).toBeTruthy();
  });

  it('counts passing against the total', () => {
    checks = summary([check(), check({ id: '2', name: 'Lint', outcome: 'failure' })]);
    render(<ChecksPill />);
    expect(screen.getByTestId('checks-pill').textContent).toContain('1/2');
  });

  it('takes its tone from the worst required outcome', () => {
    checks = summary([check(), check({ id: '2', outcome: 'pending' })]);
    const { rerender } = render(<ChecksPill />);
    expect(screen.getByTestId('checks-pill').className).toContain('checks-pill--pending');

    checks = summary([check(), check({ id: '2', outcome: 'failure' }), check({ id: '3', outcome: 'pending' })]);
    rerender(<ChecksPill />);
    expect(screen.getByTestId('checks-pill').className).toContain('checks-pill--failing');

    checks = summary([check()]);
    rerender(<ChecksPill />);
    expect(screen.getByTestId('checks-pill').className).toContain('checks-pill--passing');
  });

  it('excludes optional failures and pending statuses from required progress and tone', () => {
    checks = summary([
      check(),
      check({ id: '2', isRequired: false, outcome: 'failure' }),
      check({ id: '3', kind: 'status', isRequired: false, outcome: 'pending' }),
    ]);
    render(<ChecksPill />);
    const pill = screen.getByTestId('checks-pill');
    expect(pill).toHaveTextContent('1/1 required checks passing');
    expect(pill).toHaveClass('checks-pill--passing');
    expect(pill.title).toContain('2 optional checks (informational)');
  });

  it('shows optional-only checks as informational even when they fail or run', () => {
    checks = summary([
      check({ isRequired: false, outcome: 'failure' }),
      check({ id: '2', isRequired: false, outcome: 'pending' }),
    ]);
    render(<ChecksPill />);
    expect(screen.getByTestId('checks-pill')).toHaveClass('checks-pill--informational');
    expect(screen.getByTestId('checks-pill')).toHaveTextContent('2 optional checks');
    expect(screen.getByTestId('checks-pill')).not.toHaveTextContent('passing');
  });

  it('does not claim unknown requirements are optional or all passing', () => {
    checks = summary([check({ isRequired: undefined, outcome: 'failure' })]);
    const { rerender } = render(<ChecksPill />);
    expect(screen.getByTestId('checks-pill')).toHaveTextContent('1 check');
    expect(screen.getByTestId('checks-pill').title).toContain('unknown requirements');

    checks = summary([check(), check({ id: '2', isRequired: undefined })]);
    rerender(<ChecksPill />);
    expect(screen.getByTestId('checks-pill')).toHaveClass('checks-pill--informational');
  });
});

describe('ChecksDialog', () => {
  function open(list: PrCheck[]) {
    checks = summary(list);
    render(<ChecksPill />);
    fireEvent.click(screen.getByTestId('checks-pill'));
  }

  it('opens from the pill and closes again', () => {
    open([check()]);
    expect(screen.getByTestId('checks-dialog')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('checks-dialog')).toBeNull();
  });

  it('lists every check with a link to its page on GitHub', () => {
    open([check({ name: 'Build', description: 'Build succeeded' })]);
    expect(screen.getByText('Build succeeded')).toBeTruthy();
    const link = screen.getByText('Details ↗') as HTMLAnchorElement;
    expect(link.href).toContain('/pull/123/checks?check_run_id=1');
  });

  it('labels required, optional and unknown rows without hiding optional failures', () => {
    open([
      check({ name: 'Required build' }),
      check({ id: '2', name: 'Optional scan', kind: 'status', isRequired: false, outcome: 'failure' }),
      check({ id: '3', name: 'Unknown check', isRequired: undefined }),
    ]);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Required')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Optional')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('img', { name: 'Failed' })).toBeInTheDocument();
    expect(within(rows[2]).getByText('Requirement unknown')).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 reported required checks passing/)).toHaveTextContent(
      'Optional checks are informational and do not block merging.',
    );
    expect(screen.getByText(/Some check requirements could not be determined/)).toBeInTheDocument();
  });



  it('re-reads the checks on request', () => {
    open([check()]);
    fireEvent.click(screen.getByTestId('checks-recheck'));
    expect(refreshChecks).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    open([check()]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('checks-dialog')).toBeNull();
  });
});
