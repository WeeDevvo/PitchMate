/**
 * Unit tests for the Confirm_Dialog.
 *
 * These pin the behaviour every confirmation of the feature inherits — the invite
 * revoke and the promotion to admin — so neither has to re-test it:
 *
 *   - focus enters the surface on open, landing on the dismiss control
 *     (Requirement 19.7),
 *   - focus returns to the opener on dismissal, on Escape, and when the caller
 *     closes the dialog after the confirmed action succeeds (Requirement 19.7),
 *   - Escape closes without confirming, so no call is issued on that path
 *     (Requirement 19.8),
 *   - a closed dialog contributes nothing to the accessibility tree.
 *
 * The harness renders two identical-looking openers, because that is the situation
 * the feature actually creates: several revoke controls in an invite listing read
 * alike, and "focus returned to the control that opened it" is only a meaningful
 * claim when there is more than one candidate.
 *
 * The generated coverage over every surface and every opener of the feature is
 * Property 46's, in `focusManagement.property.test.tsx`.
 *
 * Feature: web-squads-screens
 */
import { useRef, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CANCEL_LABEL } from '../lib/messages';
import { ConfirmDialog } from './ConfirmDialog';
import type { SurfaceCloseReason, SurfaceHeadingLevel } from './surfaceFocus';

const HEADING = 'Promote to admin';
const STATEMENT = 'Dave will be able to organise matches and manage this squad.';
const CONFIRM_LABEL = 'Promote';
const FIRST_OPENER_TEST_ID = 'opener-first';
const SECOND_OPENER_TEST_ID = 'opener-second';
const OPENER_LABEL = 'Make admin';

interface HarnessProps {
  readonly onConfirm?: () => void;
  readonly onClose?: (reason: SurfaceCloseReason) => void;
  /** Leaves the dialog open when a close is requested, as a caller may. */
  readonly ignoreClose?: boolean;
  /** Closes the dialog once confirmed, as a successful path does. */
  readonly closeOnConfirm?: boolean;
  readonly pending?: boolean;
  readonly headingLevel?: SurfaceHeadingLevel;
}

function Harness({
  onConfirm,
  onClose,
  ignoreClose = false,
  closeOnConfirm = false,
  pending = false,
  headingLevel,
}: HarnessProps): ReactElement {
  const [openFor, setOpenFor] = useState<'first' | 'second' | null>(null);
  const firstOpenerRef = useRef<HTMLButtonElement>(null);
  const secondOpenerRef = useRef<HTMLButtonElement>(null);
  const openerRef = openFor === 'second' ? secondOpenerRef : firstOpenerRef;

  return (
    <div>
      <button type="button">Before</button>
      <button
        type="button"
        data-testid={FIRST_OPENER_TEST_ID}
        ref={firstOpenerRef}
        onClick={() => setOpenFor('first')}
      >
        {OPENER_LABEL}
      </button>
      <button
        type="button"
        data-testid={SECOND_OPENER_TEST_ID}
        ref={secondOpenerRef}
        onClick={() => setOpenFor('second')}
      >
        {OPENER_LABEL}
      </button>
      <ConfirmDialog
        open={openFor !== null}
        openerRef={openerRef}
        heading={HEADING}
        headingLevel={headingLevel}
        confirmLabel={CONFIRM_LABEL}
        pending={pending}
        onConfirm={() => {
          onConfirm?.();
          if (closeOnConfirm) {
            setOpenFor(null);
          }
        }}
        onClose={(reason) => {
          onClose?.(reason);
          if (!ignoreClose) {
            setOpenFor(null);
          }
        }}
      >
        {STATEMENT}
      </ConfirmDialog>
      <button type="button">After</button>
    </div>
  );
}

function firstOpener(): HTMLElement {
  return screen.getByTestId(FIRST_OPENER_TEST_ID);
}

function secondOpener(): HTMLElement {
  return screen.getByTestId(SECOND_OPENER_TEST_ID);
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-squads-surface="confirm-dialog"]');
}

describe('ConfirmDialog — a closed dialog is absent', () => {
  it('renders nothing at all while closed', () => {
    render(<Harness />);

    expect(dialog()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: CONFIRM_LABEL })).toBeNull();
    expect(screen.queryByText(STATEMENT)).toBeNull();
  });
});

describe('ConfirmDialog — focus entry (Requirement 19.7)', () => {
  it('moves focus to the first focusable element, which is the way out', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(firstOpener());

    // The dismiss control is rendered before the confirm control, so a stray Space
    // or Enter on an opening confirmation cancels rather than proceeds.
    expect(screen.getByRole('button', { name: CANCEL_LABEL })).toHaveFocus();
  });

  it('is named by its heading and described by its statement', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(firstOpener());

    const surface = screen.getByRole('dialog', { name: HEADING });
    expect(surface).toBe(dialog());
    expect(surface).toHaveAccessibleDescription(STATEMENT);
    expect(screen.getByRole('heading', { level: 2, name: HEADING })).toBeInTheDocument();
    // No focus trap is implemented, so none is claimed.
    expect(surface).not.toHaveAttribute('aria-modal');
  });

  it('renders the heading at the level the caller states', async () => {
    const user = userEvent.setup();
    render(<Harness headingLevel={4} />);

    await user.click(firstOpener());

    expect(screen.getByRole('heading', { level: 4, name: HEADING })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});

describe('ConfirmDialog — focus return (Requirement 19.7)', () => {
  it('returns focus to the opener that opened it, not to a look-alike', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(secondOpener());
    await user.click(screen.getByRole('button', { name: CANCEL_LABEL }));

    // The reason the opener arrives as a ref: a DOM search would have to guess
    // between two controls with the same accessible name.
    expect(secondOpener()).toHaveFocus();
    expect(firstOpener()).not.toHaveFocus();
  });

  it('returns focus to the opener when the caller closes it after confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} closeOnConfirm />);

    await user.click(firstOpener());
    await user.click(screen.getByRole('button', { name: CONFIRM_LABEL }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    expect(firstOpener()).toHaveFocus();
  });

  it('reports the dismissal reason and confirms nothing', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<Harness onClose={onClose} onConfirm={onConfirm} />);

    await user.click(firstOpener());
    await user.click(screen.getByRole('button', { name: CANCEL_LABEL }));

    expect(onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(firstOpener()).toHaveFocus();
  });

  it('keeps focus inside the dialog while the caller ignores the close', async () => {
    const user = userEvent.setup();
    render(<Harness ignoreClose />);

    await user.click(firstOpener());
    const cancel = screen.getByRole('button', { name: CANCEL_LABEL });
    await user.click(cancel);

    expect(dialog()).not.toBeNull();
    expect(cancel).toHaveFocus();
  });
});

describe('ConfirmDialog — Escape (Requirement 19.8)', () => {
  it('closes without confirming and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<Harness onClose={onClose} onConfirm={onConfirm} />);

    await user.click(firstOpener());
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledExactlyOnceWith('escape');
    // The whole point of 19.8: the confirmed action does not happen, so no call is
    // issued.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(firstOpener()).toHaveFocus();
  });

  it('closes from the confirm control without confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(firstOpener());
    screen.getByRole('button', { name: CONFIRM_LABEL }).focus();
    await user.keyboard('{Escape}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(firstOpener()).toHaveFocus();
  });

  it('ignores Escape pressed outside the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(firstOpener());
    screen.getByRole('button', { name: 'After' }).focus();
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });
});

describe('ConfirmDialog — confirmation', () => {
  it('confirms once per activation', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(firstOpener());
    await user.click(screen.getByRole('button', { name: CONFIRM_LABEL }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('reports a pending action and confirms nothing further while it waits', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} pending />);

    await user.click(firstOpener());
    const confirm = screen.getByRole('button', { name: CONFIRM_LABEL });

    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).not.toBeDisabled();

    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
