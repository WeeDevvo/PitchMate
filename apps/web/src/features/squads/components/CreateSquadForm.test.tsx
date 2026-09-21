/**
 * Unit tests for the Create_Squad_Form.
 *
 * They pin what the form owns rather than what it inherits: the two labelled
 * fields (Requirement 3.1), the trimmed submission (Requirement 3.2), the field
 * messages that block a call while keeping every entered value (Requirement 3.3),
 * and the treatment of a backend rejection as an outcome message in a live region
 * with the submit control still available (Requirements 3.8, 3.9).
 *
 * Focus entry and return, Escape, and the pending submit control belong to the
 * Form_Panel and are pinned by `FormPanel.test.tsx`, so they are exercised here
 * only where this form's own behaviour depends on them.
 *
 * The harness owns the open state exactly as the Squads_Home will, so "the form
 * is still rendered with its values" is a claim about a caller that keeps it open
 * after a rejection.
 *
 * Feature: web-squads-screens
 */
import { useRef, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  CREATE_SQUAD_HEADING,
  CREATE_SQUAD_SUBMIT_LABEL,
  CREATOR_DISPLAY_NAME_LABEL,
  DISPLAY_NAME_REQUIRED_MESSAGE,
  DISPLAY_NAME_TOO_LONG_MESSAGE,
  GENERIC_SQUADS_FAILURE,
  SQUAD_NAME_LABEL,
  SQUAD_NAME_REQUIRED_MESSAGE,
  SQUAD_NAME_TOO_LONG_MESSAGE,
} from '../lib/messages';
import { NAME_MAX_LENGTH } from '../lib/nameValidation';
import { CreateSquadForm, CREATE_SQUAD_FORM_ID } from './CreateSquadForm';

const OPENER_LABEL = 'Create a squad';

interface HarnessProps {
  readonly onSubmit?: (command: {
    name: null | string;
    displayName: null | string;
  }) => void;
  readonly pending?: boolean;
  readonly outcomeMessage?: string | null;
}

function Harness({
  onSubmit,
  pending,
  outcomeMessage,
}: HarnessProps): ReactElement {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button type="button" ref={openerRef} onClick={() => setOpen(true)}>
        {OPENER_LABEL}
      </button>
      <CreateSquadForm
        open={open}
        openerRef={openerRef}
        pending={pending}
        outcomeMessage={outcomeMessage}
        onSubmit={(command) => onSubmit?.(command)}
        // A rejection leaves the panel open, which is the caller behaviour
        // Requirement 3.8 describes; only a close request closes it.
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: OPENER_LABEL }));
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText(SQUAD_NAME_LABEL) as HTMLInputElement;
}

function displayNameField(): HTMLInputElement {
  return screen.getByLabelText(CREATOR_DISPLAY_NAME_LABEL) as HTMLInputElement;
}

function submitControl(): HTMLElement {
  return screen.getByRole('button', { name: CREATE_SQUAD_SUBMIT_LABEL });
}

/** The message text programmatically associated with a field, or `null`. */
function describedMessage(field: HTMLElement): string | null {
  const id = field.getAttribute('aria-describedby');
  if (id === null) {
    return null;
  }

  return document.getElementById(id)?.textContent ?? null;
}

describe('CreateSquadForm — the two labelled fields (Requirement 3.1)', () => {
  it('presents both fields with persistently visible labels and a submit control', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);

    // Real `<label>` elements, so the labels are visible text rather than
    // placeholders that vanish as soon as something is typed.
    expect(nameField()).toBeInTheDocument();
    expect(displayNameField()).toBeInTheDocument();
    expect(screen.getByText(SQUAD_NAME_LABEL)).toBeVisible();
    expect(screen.getByText(CREATOR_DISPLAY_NAME_LABEL)).toBeVisible();
    expect(submitControl()).toBeInTheDocument();
    expect(screen.getByRole('group', { name: CREATE_SQUAD_HEADING })).toHaveAttribute(
      'id',
      CREATE_SQUAD_FORM_ID,
    );
  });

  it('renders nothing while closed', () => {
    render(<Harness />);

    expect(screen.queryByLabelText(SQUAD_NAME_LABEL)).toBeNull();
    expect(screen.queryByLabelText(CREATOR_DISPLAY_NAME_LABEL)).toBeNull();
  });
});

describe('CreateSquadForm — submission (Requirement 3.2)', () => {
  it('submits both values trimmed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(nameField(), '  Sunday Ballers  ');
    await user.type(displayNameField(), '  Dave  ');
    await user.click(submitControl());

    // 3.2: the trimmed values, and the values as entered are left in the fields.
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: 'Sunday Ballers',
      displayName: 'Dave',
    });
    expect(nameField()).toHaveValue('  Sunday Ballers  ');
  });

  it('submits a name of exactly the maximum length', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    const name = 'a'.repeat(NAME_MAX_LENGTH);
    fireEvent.change(nameField(), { target: { value: name } });
    await user.type(displayNameField(), 'Dave');
    await user.click(submitControl());

    // The boundary the backend accepts is accepted here too.
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name,
      displayName: 'Dave',
    });
  });
});

describe('CreateSquadForm — field validation (Requirement 3.3)', () => {
  it('issues no submission and messages both fields when both are empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(describedMessage(nameField())).toBe(SQUAD_NAME_REQUIRED_MESSAGE);
    expect(displayNameField()).toHaveAttribute('aria-invalid', 'true');
    expect(describedMessage(displayNameField())).toBe(
      DISPLAY_NAME_REQUIRED_MESSAGE,
    );
  });

  it('treats a whitespace-only value as empty and keeps it in the field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(nameField(), '   ');
    await user.type(displayNameField(), 'Dave');
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(describedMessage(nameField())).toBe(SQUAD_NAME_REQUIRED_MESSAGE);
    // 3.3: every entered value is kept — the form rewrites nothing.
    expect(nameField()).toHaveValue('   ');
    expect(displayNameField()).toHaveValue('Dave');
  });

  it('messages a value longer than the column after trimming', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    // Pasted rather than typed: the `maxLength` attribute caps typing, so
    // submission-time validation is what catches a value that arrives whole.
    const tooLong = `  ${'a'.repeat(NAME_MAX_LENGTH + 1)}  `;
    fireEvent.change(nameField(), { target: { value: tooLong } });
    fireEvent.change(displayNameField(), { target: { value: tooLong } });
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(describedMessage(nameField())).toBe(SQUAD_NAME_TOO_LONG_MESSAGE);
    expect(describedMessage(displayNameField())).toBe(
      DISPLAY_NAME_TOO_LONG_MESSAGE,
    );
    expect(nameField()).toHaveValue(tooLong);
  });

  it('clears a field message as soon as that field is edited', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);
    await user.click(submitControl());
    expect(describedMessage(nameField())).toBe(SQUAD_NAME_REQUIRED_MESSAGE);

    await user.type(nameField(), 'S');

    // The message was about a value that no longer exists.
    expect(nameField()).not.toHaveAttribute('aria-invalid');
    expect(describedMessage(nameField())).toBeNull();
    // The other field's message is about its own value, so it stays.
    expect(describedMessage(displayNameField())).toBe(
      DISPLAY_NAME_REQUIRED_MESSAGE,
    );
  });

  it('states the column bound its copy claims', () => {
    // The messages carry no interpolation, so the number is written out. This
    // keeps the copy and `NAME_MAX_LENGTH` from drifting apart.
    expect(SQUAD_NAME_TOO_LONG_MESSAGE).toContain(String(NAME_MAX_LENGTH));
    expect(DISPLAY_NAME_TOO_LONG_MESSAGE).toContain(String(NAME_MAX_LENGTH));
  });
});

describe('CreateSquadForm — a backend rejection (Requirements 3.8, 3.9)', () => {
  it('renders the outcome in a live region, not as a field message', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Harness onSubmit={onSubmit} outcomeMessage={null} />,
    );

    await open(user);
    await user.type(nameField(), 'Sunday Ballers');
    await user.type(displayNameField(), 'Dave');
    await user.click(submitControl());
    expect(onSubmit).toHaveBeenCalledOnce();

    // The call came back rejected: the caller keeps the panel open and hands the
    // form one fixed message.
    rerender(
      <Harness onSubmit={onSubmit} outcomeMessage={GENERIC_SQUADS_FAILURE} />,
    );

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(GENERIC_SQUADS_FAILURE);
    expect(region).toHaveAttribute('aria-live', 'polite');

    // 3.9: the backend's verdict is not a field validation message.
    expect(nameField()).not.toHaveAttribute('aria-invalid');
    expect(displayNameField()).not.toHaveAttribute('aria-invalid');
    expect(describedMessage(nameField())).toBeNull();

    // 3.8: every entered value retained, and the submit control available again.
    expect(nameField()).toHaveValue('Sunday Ballers');
    expect(displayNameField()).toHaveValue('Dave');
    expect(submitControl()).not.toHaveAttribute('aria-disabled');
  });

  it('accepts a further submission after a rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} outcomeMessage={GENERIC_SQUADS_FAILURE} />);

    await open(user);
    await user.type(nameField(), 'Sunday Ballers');
    await user.type(displayNameField(), 'Dave');
    await user.click(submitControl());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: 'Sunday Ballers',
      displayName: 'Dave',
    });
  });

  it('holds the live region even with nothing to report', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);

    // Present but empty, so a message inserted later is announced.
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent('');
  });
});

describe('CreateSquadForm — a pending submission (Requirement 3.5)', () => {
  it('issues no further submission while a call awaits a response', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} pending />);

    await open(user);
    await user.type(nameField(), 'Sunday Ballers');
    await user.type(displayNameField(), 'Dave');
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    // `aria-disabled`, so the control keeps the focus of whoever activated it.
    expect(submitControl()).toHaveAttribute('aria-disabled', 'true');
    expect(submitControl()).not.toBeDisabled();
  });
});
