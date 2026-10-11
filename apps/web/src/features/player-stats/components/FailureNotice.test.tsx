/**
 * Unit tests for the failure notice.
 *
 * The notice carries the whole of the feature's transport-failure, timeout, and
 * parse-failure treatment, so these tests pin every clause of it:
 *
 *   - the single {@link GENERIC_PROFILE_FAILURE} and nothing else (4.1, 4.2),
 *   - no seam for backend content — there is no `message`, `reason`, or `status`
 *     prop, asserted as a shape claim over the rendered subtree (3.7, 4.2),
 *   - the statement in a live region, announced with keyboard focus left alone
 *     (4.6),
 *   - exactly one retry control, reachable and operable by keyboard and named by
 *     the retry action (4.4),
 *   - that control presented as unavailable while a retry is pending, without
 *     leaving the keyboard order (4.5, 16.4),
 *   - and nothing re-issuing itself (2.6).
 *
 * The notice must also never be mistaken for the Not_Found_Treatment, so the last
 * block asserts it renders neither that heading nor that statement
 * (Requirement 4.3).
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FAILURE_NOTICE_SELECTOR, FailureNotice } from './FailureNotice';
import {
  GENERIC_PROFILE_FAILURE,
  NOT_FOUND_TREATMENT_HEADING,
  NOT_FOUND_TREATMENT_STATEMENT,
  RETRY_LABEL,
} from '../lib/messages';

/** The label of a stand-in for the additional, screen-supplied control. */
const EXTRA_CONTROL_LABEL = 'Back to the squad stand-in';

describe('FailureNotice message (Reqs 4.1, 4.2, 3.7)', () => {
  it('renders the one generic failure statement', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    expect(screen.getByText(GENERIC_PROFILE_FAILURE)).toBeVisible();
  });

  it('renders exactly the fixed statement and the retry label, so no response content can reach it', () => {
    const { container } = render(<FailureNotice onRetry={vi.fn()} />);

    expect(container.querySelector(FAILURE_NOTICE_SELECTOR)?.textContent).toBe(
      `${GENERIC_PROFILE_FAILURE}${RETRY_LABEL}`,
    );
  });

  it('carries no digit, so no status code or count can have been folded in', () => {
    const { container } = render(<FailureNotice onRetry={vi.fn()} />);

    const text = container.querySelector(FAILURE_NOTICE_SELECTOR)?.textContent ?? '';

    expect(text).not.toMatch(/\d/u);
  });
});

describe('FailureNotice announcement (Req 4.6)', () => {
  it('places the statement in a polite, atomic live region', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    const region = screen.getByRole('status');

    expect(region).toHaveTextContent(GENERIC_PROFILE_FAILURE);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('keeps the retry control out of the live region, so only the outcome is announced', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    expect(screen.getByRole('status')).not.toHaveTextContent(RETRY_LABEL);
  });

  it('leaves keyboard focus where it was', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    expect(document.activeElement).toBe(document.body);
  });
});

describe('FailureNotice retry control (Reqs 2.6, 4.4)', () => {
  it('renders exactly one retry control, named by the retry action', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    const controls = screen.getAllByRole('button');

    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAccessibleName(RETRY_LABEL);
  });

  it('issues nothing until a person activates it', () => {
    const onRetry = vi.fn();

    render(<FailureNotice onRetry={onRetry} />);

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('issues exactly one further call per activation', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<FailureNotice onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: RETRY_LABEL }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: RETRY_LABEL }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('is reachable and operable by keyboard with Enter', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<FailureNotice onRetry={onRetry} />);

    await user.tab();
    expect(screen.getByRole('button', { name: RETRY_LABEL })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is operable by keyboard with Space', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<FailureNotice onRetry={onRetry} />);

    await user.tab();
    await user.keyboard(' ');

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('FailureNotice while a retry is pending (Reqs 4.5, 16.4)', () => {
  it('presents the control as unavailable for further activation', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<FailureNotice onRetry={onRetry} retryBusy />);

    const retry = screen.getByRole('button', { name: RETRY_LABEL });

    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).toHaveAttribute('aria-busy', 'true');

    await user.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('blocks a keyboard activation too', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<FailureNotice onRetry={onRetry} retryBusy />);

    await user.tab();
    await user.keyboard('{Enter}');

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keeps the control reachable in the keyboard order', async () => {
    const user = userEvent.setup();

    render(<FailureNotice onRetry={vi.fn()} retryBusy />);

    await user.tab();

    expect(screen.getByRole('button', { name: RETRY_LABEL })).toHaveFocus();
  });

  it('presents the control as available again once the retry settles', () => {
    const { rerender } = render(<FailureNotice onRetry={vi.fn()} retryBusy />);

    rerender(<FailureNotice onRetry={vi.fn()} />);

    const retry = screen.getByRole('button', { name: RETRY_LABEL });

    expect(retry).not.toHaveAttribute('aria-disabled');
    expect(retry).not.toHaveAttribute('aria-busy');
  });
});

describe('FailureNotice is never the Not_Found_Treatment (Req 4.3)', () => {
  it('renders neither the not-found heading nor its statement', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    expect(screen.queryByText(NOT_FOUND_TREATMENT_HEADING)).toBeNull();
    expect(screen.queryByText(NOT_FOUND_TREATMENT_STATEMENT)).toBeNull();
  });

  it('renders no level-one heading, so the screen still owes exactly one elsewhere', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });
});

describe('FailureNotice additional control slot', () => {
  it('renders an injected control after the retry in document order', () => {
    render(
      <FailureNotice onRetry={vi.fn()}>
        <button type="button">{EXTRA_CONTROL_LABEL}</button>
      </FailureNotice>,
    );

    const controls = screen.getAllByRole('button');

    expect(controls).toHaveLength(2);
    expect(controls[0]).toHaveTextContent(RETRY_LABEL);
    expect(controls[1]).toHaveTextContent(EXTRA_CONTROL_LABEL);
  });

  it('renders the retry alone when no further control is supplied', () => {
    render(<FailureNotice onRetry={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
