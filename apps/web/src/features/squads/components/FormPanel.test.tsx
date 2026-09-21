/**
 * Unit tests for the Form_Panel.
 *
 * These pin the behaviour every form of the feature inherits by rendering inside
 * it, so no later form has to re-test it:
 *
 *   - focus enters the surface on open, landing on the first field
 *     (Requirement 19.7),
 *   - focus returns to the opener on dismissal, on Escape, and when the caller
 *     closes the panel itself after a successful submission (Requirement 19.7),
 *   - Escape closes without submitting, so no call is issued on that path
 *     (Requirement 19.8),
 *   - a closed panel contributes nothing to the accessibility tree or the focus
 *     order.
 *
 * The panel is controlled, so the harness below owns the open state exactly as a
 * screen will, and records every close reason. A focusable control sits before and
 * after the opener, so "focus went back to the opener" is a claim with somewhere
 * else it could have gone.
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
import { FormPanel } from './FormPanel';
import type { SurfaceCloseReason, SurfaceHeadingLevel } from './surfaceFocus';

const HEADING = 'Create a squad';
const SUBMIT_LABEL = 'Create squad';
const OPENER_LABEL = 'New squad';
const FIELD_LABEL = 'Squad name';
const EXTERNAL_CLOSE_LABEL = 'Close from outside';

interface HarnessProps {
  readonly onSubmit?: () => void;
  readonly onClose?: (reason: SurfaceCloseReason) => void;
  /** Leaves the panel open when a close is requested, as a caller may. */
  readonly ignoreClose?: boolean;
  /** Closes the panel when the form is submitted, as a successful path does. */
  readonly closeOnSubmit?: boolean;
  readonly pending?: boolean;
  readonly headingLevel?: SurfaceHeadingLevel;
}

function Harness({
  onSubmit,
  onClose,
  ignoreClose = false,
  closeOnSubmit = false,
  pending = false,
  headingLevel,
}: HarnessProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button type="button">Before</button>
      <button type="button" ref={openerRef} onClick={() => setOpen(true)}>
        {OPENER_LABEL}
      </button>
      <FormPanel
        open={open}
        openerRef={openerRef}
        heading={HEADING}
        headingLevel={headingLevel}
        submitLabel={SUBMIT_LABEL}
        pending={pending}
        onSubmit={() => {
          onSubmit?.();
          if (closeOnSubmit) {
            setOpen(false);
          }
        }}
        onClose={(reason) => {
          onClose?.(reason);
          if (!ignoreClose) {
            setOpen(false);
          }
        }}
      >
        <label htmlFor="squad-name">{FIELD_LABEL}</label>
        <input
          id="squad-name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </FormPanel>
      {/* A control outside the panel that closes it, so "the caller closed it
          while focus was elsewhere" is reachable in a test. */}
      <button type="button" onClick={() => setOpen(false)}>
        {EXTERNAL_CLOSE_LABEL}
      </button>
      <button type="button">After</button>
    </div>
  );
}

function opener(): HTMLElement {
  return screen.getByRole('button', { name: OPENER_LABEL });
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-squads-surface="form-panel"]');
}

async function open(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(opener());
}

describe('FormPanel — a closed panel is absent', () => {
  it('renders nothing at all while closed', () => {
    render(<Harness />);

    // Requirement 19.4 depends on this: a hidden-but-present panel would leave its
    // fields in the focus order of the screen around it.
    expect(panel()).toBeNull();
    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: SUBMIT_LABEL })).toBeNull();
    expect(screen.queryByRole('group', { name: HEADING })).toBeNull();
  });
});

describe('FormPanel — focus entry (Requirement 19.7)', () => {
  it('moves focus to the first focusable element of the surface on open', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);

    // The fields are rendered before the action row, so the first focusable
    // element is the form's first field rather than a button.
    expect(screen.getByLabelText(FIELD_LABEL)).toHaveFocus();
  });

  it('names the surface by its heading and defaults it to level two', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);

    const surface = screen.getByRole('group', { name: HEADING });
    expect(surface).toBe(panel());
    expect(screen.getByRole('heading', { level: 2, name: HEADING })).toBeInTheDocument();
  });

  it('renders the heading at the level the caller states', async () => {
    const user = userEvent.setup();
    render(<Harness headingLevel={4} />);

    await open(user);

    // A panel opened from inside a section that already has an h2 and an h3 states
    // h4, so the screen's outline skips no level (Requirements 19.1, 19.2).
    expect(screen.getByRole('heading', { level: 4, name: HEADING })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});

describe('FormPanel — focus return (Requirement 19.7)', () => {
  it('returns focus to the opener when the panel is dismissed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness onClose={onClose} onSubmit={onSubmit} />);

    await open(user);
    await user.click(screen.getByRole('button', { name: CANCEL_LABEL }));

    expect(onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('returns focus to the opener when the caller closes the panel itself', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} closeOnSubmit />);

    await open(user);
    await user.click(screen.getByRole('button', { name: SUBMIT_LABEL }));

    // The successful-submission path: the screen closes the panel, and focus comes
    // back to the opener without the panel being told why.
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(panel()).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('leaves focus alone when a person moved it out of the panel first', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);
    // Nothing here confines focus, so a person may Tab out of an open panel and
    // carry on. Closing it then would make returning focus to the opener an act of
    // taking focus rather than returning it.
    const externalClose = screen.getByRole('button', { name: EXTERNAL_CLOSE_LABEL });
    await user.click(externalClose);

    expect(panel()).toBeNull();
    expect(externalClose).toHaveFocus();
    expect(opener()).not.toHaveFocus();
  });

  it('keeps focus inside the panel while the caller ignores the close', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} ignoreClose />);

    await open(user);
    const cancel = screen.getByRole('button', { name: CANCEL_LABEL });
    await user.click(cancel);

    expect(onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
    expect(panel()).not.toBeNull();
    expect(cancel).toHaveFocus();
  });
});

describe('FormPanel — Escape (Requirement 19.8)', () => {
  it('closes without submitting and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness onClose={onClose} onSubmit={onSubmit} />);

    await open(user);
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledExactlyOnceWith('escape');
    // The whole point of 19.8: no submission, so no call is issued.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('closes from a field, with the entered value never submitted', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(screen.getByLabelText(FIELD_LABEL), 'Sunday Ballers');
    await user.keyboard('{Escape}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('ignores Escape pressed outside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await open(user);
    screen.getByRole('button', { name: 'After' }).focus();
    await user.keyboard('{Escape}');

    // Requirement 19.8 is scoped to focus being inside the surface; a key pressed
    // elsewhere on the screen is none of the panel's business.
    expect(onClose).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });
});

describe('FormPanel — submission', () => {
  it('submits once from the submit control and once from Enter in a field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.click(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(onSubmit).toHaveBeenCalledOnce();

    await user.type(screen.getByLabelText(FIELD_LABEL), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('reports a pending submission and issues nothing further while it waits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} pending />);

    await open(user);
    const submit = screen.getByRole('button', { name: SUBMIT_LABEL });

    // `aria-disabled` rather than `disabled`, so the control keeps the focus of
    // whoever just activated it while the call is in flight.
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(submit).not.toBeDisabled();

    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the panel open and the entered values retained after a submission', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);
    const field = screen.getByLabelText(FIELD_LABEL);
    await user.type(field, 'Sunday Ballers');
    await user.click(screen.getByRole('button', { name: SUBMIT_LABEL }));

    // Open state is the caller's, so a rejected submission can leave every value in
    // place with the submit control still available (Requirements 3.8, 4.9).
    expect(panel()).not.toBeNull();
    expect(field).toHaveValue('Sunday Ballers');
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeInTheDocument();
  });
});
