/**
 * Unit tests for the failure notice.
 *
 * The notice carries the whole of the feature's transport-failure, timeout, and
 * parse-failure treatment, so these tests pin all four clauses of it:
 *
 *   - the single {@link GENERIC_SQUADS_FAILURE} and nothing else (17.1),
 *   - no seam for backend content — the component has no `message` prop, which is
 *     asserted as a shape claim over its rendered text (17.2),
 *   - the message in a live region, announced with keyboard focus left alone
 *     (17.3),
 *   - a manual retry that issues on activation only, never by itself, and never
 *     twice while a call awaits a response (2.6, 17.4).
 *
 * The `children` slot is exercised too, because the Invite_Landing_Route offers a
 * control to the Squads_Home beside the retry (5.13) while the Squads_Home itself
 * offers none.
 *
 * Feature: web-squads-screens
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FAILURE_NOTICE_SELECTOR, FailureNotice } from './FailureNotice';
import { GENERIC_SQUADS_FAILURE } from '../lib/messages';

/** A surface-supplied retry label, standing in for whichever call failed. */
const RETRY_LABEL = 'Try again';

/** The label of a stand-in for an additional, surface-specific control. */
const EXTRA_CONTROL_LABEL = 'Go to your squads';

describe('FailureNotice message (Reqs 17.1, 17.2)', () => {
  it('renders the one generic failure message', () => {
    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()} />);

    expect(screen.getByText(GENERIC_SQUADS_FAILURE)).toBeVisible();
  });

  it('renders exactly the fixed message and the retry label, so no response content can reach it', () => {
    const { container } = render(
      <FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()} />,
    );

    expect(container.querySelector(FAILURE_NOTICE_SELECTOR)?.textContent).toBe(
      `${GENERIC_SQUADS_FAILURE}${RETRY_LABEL}`,
    );
  });
});

describe('FailureNotice announcement (Req 17.3)', () => {
  it('places the message in a polite live region', () => {
    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()} />);

    const region = screen.getByRole('status');

    expect(region).toHaveTextContent(GENERIC_SQUADS_FAILURE);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('keeps the retry control out of the live region, so only the outcome is announced', () => {
    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()} />);

    const region = screen.getByRole('status');

    expect(region).not.toHaveTextContent(RETRY_LABEL);
  });

  it('leaves keyboard focus where it was', () => {
    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()} />);

    expect(document.activeElement).toBe(document.body);
  });
});

describe('FailureNotice retry (Reqs 2.6, 17.4)', () => {
  it('issues nothing until a person activates it', () => {
    const onRetry = vi.fn();

    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={onRetry} />);

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('issues exactly one further call per activation', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: RETRY_LABEL }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: RETRY_LABEL }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('is operable by keyboard', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={onRetry} />);

    await user.tab();
    expect(screen.getByRole('button', { name: RETRY_LABEL })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('FailureNotice while a retry awaits a response (Req 17.4)', () => {
  it('marks the control busy and blocks a second activation', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <FailureNotice retryLabel={RETRY_LABEL} onRetry={onRetry} retryBusy />,
    );

    const retry = screen.getByRole('button', { name: RETRY_LABEL });

    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).toHaveAttribute('aria-busy', 'true');

    await user.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keeps the control reachable in the keyboard order (Req 19.4)', async () => {
    const user = userEvent.setup();

    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()} retryBusy />);

    await user.tab();

    expect(screen.getByRole('button', { name: RETRY_LABEL })).toHaveFocus();
  });
});

describe('FailureNotice additional controls (Req 5.13)', () => {
  it('renders an injected control beside the retry, in document order after it', () => {
    render(
      <FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()}>
        <button type="button">{EXTRA_CONTROL_LABEL}</button>
      </FailureNotice>,
    );

    const controls = screen.getAllByRole('button');

    expect(controls).toHaveLength(2);
    expect(controls[0]).toHaveTextContent(RETRY_LABEL);
    expect(controls[1]).toHaveTextContent(EXTRA_CONTROL_LABEL);
  });

  it('renders the retry alone when no further control is supplied', () => {
    render(<FailureNotice retryLabel={RETRY_LABEL} onRetry={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
