/**
 * Unit tests for the shared disclosure primitive.
 *
 * These pin the four behaviours the Notification_Panel, the Account_Menu, and the
 * compact Primary_Navigation all inherit from this component:
 *
 *   - the trigger reports the state and names the surface it controls
 *     (Requirements 5.1, 8.1),
 *   - the surface is rendered immediately after the trigger, so its controls fall
 *     in the focus order between the trigger and whatever follows, focus is not
 *     confined, and tabbing out leaves the surface open (Requirement 13.6),
 *   - Escape closes and returns focus to the trigger (Requirements 5.3, 8.5),
 *   - a pointer activation outside both the surface and the trigger closes it and
 *     leaves focus where the pointer put it (Requirements 5.14, 8.7).
 *
 * The component is controlled, so the harness below owns the open state exactly
 * as the Shell_Header will via `useDisclosureGroup`, and records the reason of
 * every close request.
 *
 * Feature: app-shell
 */
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Disclosure, type DisclosureCloseReason } from './Disclosure';

const SURFACE_ID = 'test-surface';

interface HarnessProps {
  readonly onClose?: (reason: DisclosureCloseReason) => void;
  /** Leaves the surface open when a close is requested, as a caller may. */
  readonly ignoreClose?: boolean;
}

/**
 * A trigger with a focusable control before and after it, so focus order and
 * "outside the disclosure" both have somewhere real to point at.
 */
function Harness({ onClose, ignoreClose = false }: HarnessProps): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button">Before</button>
      <Disclosure
        id={SURFACE_ID}
        open={open}
        onRequestOpen={() => setOpen(true)}
        onRequestClose={(reason) => {
          onClose?.(reason);
          if (!ignoreClose) {
            setOpen(false);
          }
        }}
        trigger={(triggerProps) => (
          <button type="button" {...triggerProps}>
            Notifications
          </button>
        )}
      >
        <button type="button">First inside</button>
        <button type="button">Last inside</button>
      </Disclosure>
      <button type="button">After</button>
    </div>
  );
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Notifications' });
}

function surface(): HTMLElement | null {
  return document.getElementById(SURFACE_ID);
}

describe('Disclosure state reporting', () => {
  // Requirements 5.1, 8.1 — the collapsed state is reported programmatically and
  // the trigger names its surface before it is ever opened.
  it('reports the collapsed state and renders no surface while closed', () => {
    render(<Harness />);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-controls', SURFACE_ID);
    expect(surface()).toBeNull();
    expect(screen.queryByRole('button', { name: 'First inside' })).not.toBeInTheDocument();
  });

  it('reports the expanded state once open', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(surface()).not.toBeNull();
  });

  // Requirement 13.6 — the surface sits immediately after the trigger, which is
  // what puts its controls in the focus order right after the trigger without a
  // focus trap.
  it('renders the surface immediately after the trigger in document order', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());

    expect(trigger().nextElementSibling).toBe(surface());
  });
});

describe('Disclosure trigger activation', () => {
  it('opens the surface when the trigger is activated while closed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());

    expect(surface()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  // Requirement 5.2 — activating the trigger of an open surface closes it, and
  // focus is already on the trigger.
  it('requests a toggle close when the trigger is activated while open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    await user.click(trigger());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('toggle');
    expect(surface()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('is operable by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    await user.tab();
    expect(trigger()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Disclosure Escape handling', () => {
  // Requirements 5.3, 8.5 — Escape from inside closes and returns focus.
  it('closes and returns focus to the trigger on Escape from inside the surface', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    await user.tab();
    expect(screen.getByRole('button', { name: 'First inside' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledWith('escape');
    expect(surface()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes and keeps focus on the trigger on Escape from the trigger itself', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledWith('escape');
    expect(trigger()).toHaveFocus();
  });

  it('ignores Escape pressed outside the disclosure', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    screen.getByRole('button', { name: 'After' }).focus();
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(surface()).not.toBeNull();
  });
});

describe('Disclosure outside pointer handling', () => {
  // Requirements 5.14, 8.7 — an outside pointer activation closes the surface and
  // leaves focus where that activation put it.
  it('closes without moving focus when a pointer lands outside', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    const outside = screen.getByRole('button', { name: 'After' });
    await user.click(outside);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('outside-pointer');
    expect(surface()).toBeNull();
    expect(outside).toHaveFocus();
    expect(trigger()).not.toHaveFocus();
  });

  it('stays open when a pointer lands inside the surface', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'First inside' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(surface()).not.toBeNull();
  });

  it('stops listening for outside pointers once closed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'After' }));
    onClose.mockClear();

    await user.click(screen.getByRole('button', { name: 'Before' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Disclosure focus order', () => {
  // Requirement 13.6 — focus is confined by nothing: Tab from the last control of
  // the surface reaches the next control of the document, and the surface stays
  // open.
  it('lets Tab leave the last control of the surface and keeps the surface open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last inside' })).toHaveFocus();

    await user.tab();

    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    expect(surface()).not.toBeNull();
  });

  // Requirement 13.6 — Shift+Tab from the first control of the surface lands on
  // the control that opened it.
  it('lets Shift+Tab from the first control of the surface reach the trigger', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(trigger());
    await user.tab();
    expect(screen.getByRole('button', { name: 'First inside' })).toHaveFocus();

    await user.tab({ shift: true });

    expect(trigger()).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    expect(surface()).not.toBeNull();
  });

  it('leaves the surface open when the caller ignores a close request', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} ignoreClose />);

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'After' }));

    expect(onClose).toHaveBeenCalledWith('outside-pointer');
    expect(surface()).not.toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });
});
