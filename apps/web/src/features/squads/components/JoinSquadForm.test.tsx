/**
 * Unit tests for the Join_Code_Form.
 *
 * They pin what the form owns: the labelled Invite_Secret field and the optional
 * display name (Requirement 4.1), the derived and trimmed submission with the
 * display name present only where one was entered (Requirement 4.2), the field
 * message that blocks a call on an empty secret (Requirement 4.3), the treatment
 * of a rejected display name as an outcome message with every value retained
 * (Requirement 4.9), and the containment of the secret itself (Requirement 4.10).
 *
 * Focus, Escape, and the pending submit control belong to the Form_Panel and are
 * pinned by `FormPanel.test.tsx`.
 *
 * Feature: web-squads-screens
 */
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { redeemableValueFrom } from '../lib/inviteSecret';
import {
  DISPLAY_NAME_TOO_LONG_MESSAGE,
  INVITE_SECRET_LABEL,
  INVITE_SECRET_REQUIRED_MESSAGE,
  INVITE_UNUSABLE,
  JOIN_DISPLAY_NAME_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
} from '../lib/messages';
import { NAME_MAX_LENGTH } from '../lib/nameValidation';
import { JoinSquadForm, JOIN_SQUAD_FORM_ID } from './JoinSquadForm';

const OPENER_LABEL = 'Join a squad';

/** A secret distinctive enough that finding it anywhere is unambiguous. */
const SECRET_CODE = 'ZQ7WKD42XB';

interface HarnessProps {
  readonly onSubmit?: (command: {
    presentedSecret: string;
    displayName?: null | string;
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
      <JoinSquadForm
        open={open}
        openerRef={openerRef}
        pending={pending}
        outcomeMessage={outcomeMessage}
        onSubmit={(command) => onSubmit?.(command)}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: OPENER_LABEL }));
}

function secretField(): HTMLInputElement {
  return screen.getByLabelText(INVITE_SECRET_LABEL) as HTMLInputElement;
}

function displayNameField(): HTMLInputElement {
  return screen.getByLabelText(JOIN_DISPLAY_NAME_LABEL) as HTMLInputElement;
}

function submitControl(): HTMLElement {
  return screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL });
}

function describedMessage(field: HTMLElement): string | null {
  const id = field.getAttribute('aria-describedby');
  if (id === null) {
    return null;
  }

  return document.getElementById(id)?.textContent ?? null;
}

/**
 * Every place the rendered document carries `secret` other than the value of the
 * Invite_Secret input itself — attributes and text alike (Requirement 4.10).
 */
function disclosuresOf(secret: string): readonly string[] {
  const field = secretField();
  const found: string[] = [];

  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (!attribute.value.includes(secret)) {
        continue;
      }

      // The one permitted place: the field's own value.
      if (element === field && attribute.name === 'value') {
        continue;
      }

      found.push(`${element.tagName.toLowerCase()}[${attribute.name}]`);
    }
  }

  // Rendered text is checked too: a message echoing the secret would be a
  // disclosure carried by no attribute at all.
  if ((document.body.textContent ?? '').includes(secret)) {
    found.push('text');
  }

  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JoinSquadForm — the labelled fields (Requirement 4.1)', () => {
  it('presents the invite field and the optional display name, both labelled', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);

    expect(secretField()).toBeInTheDocument();
    expect(displayNameField()).toBeInTheDocument();
    expect(screen.getByText(INVITE_SECRET_LABEL)).toBeVisible();
    // The optionality is stated in the visible label rather than discovered.
    expect(screen.getByText(JOIN_DISPLAY_NAME_LABEL)).toBeVisible();
    expect(JOIN_DISPLAY_NAME_LABEL.toLowerCase()).toContain('optional');
    expect(screen.getByRole('group', { name: JOIN_SQUAD_HEADING })).toHaveAttribute(
      'id',
      JOIN_SQUAD_FORM_ID,
    );
  });
});

describe('JoinSquadForm — submission (Requirements 4.2, 4.4)', () => {
  it('submits a typed code trimmed, with no display name key at all', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    fireEvent.change(secretField(), { target: { value: `  ${SECRET_CODE}  ` } });
    await user.click(submitControl());

    // 4.2: absent rather than empty, so the backend applies its own default.
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      presentedSecret: SECRET_CODE,
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('displayName');
  });

  it('submits the redeemable value derived from a pasted invite link', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    const link = `https://pitch-mate.co.uk/join/${SECRET_CODE}`;
    fireEvent.change(secretField(), { target: { value: link } });
    await user.click(submitControl());

    // 4.4: the same pure derivation the requirement names, not a second copy of
    // the rule written into the component.
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      presentedSecret: redeemableValueFrom(link),
    });
    expect(redeemableValueFrom(link)).toBe(SECRET_CODE);
  });

  it('includes the display name trimmed when one is entered', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(secretField(), SECRET_CODE);
    fireEvent.change(displayNameField(), { target: { value: '  Dave  ' } });
    await user.click(submitControl());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      presentedSecret: SECRET_CODE,
      displayName: 'Dave',
    });
  });

  it('omits a whitespace-only display name rather than messaging it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(secretField(), SECRET_CODE);
    await user.type(displayNameField(), '   ');
    await user.click(submitControl());

    // The field is optional, so nothing entered is not a failure.
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      presentedSecret: SECRET_CODE,
    });
    expect(describedMessage(displayNameField())).toBeNull();
  });
});

describe('JoinSquadForm — field validation (Requirement 4.3)', () => {
  it('issues no redemption while the invite field is empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(secretField()).toHaveAttribute('aria-invalid', 'true');
    expect(describedMessage(secretField())).toBe(INVITE_SECRET_REQUIRED_MESSAGE);
  });

  it('treats a whitespace-only invite field as empty and keeps the value', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(secretField(), '  ');
    await user.type(displayNameField(), 'Dave');
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(describedMessage(secretField())).toBe(INVITE_SECRET_REQUIRED_MESSAGE);
    expect(secretField()).toHaveValue('  ');
    expect(displayNameField()).toHaveValue('Dave');
  });

  it('messages a display name longer than the column, and submits nothing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(secretField(), SECRET_CODE);
    fireEvent.change(displayNameField(), {
      target: { value: 'a'.repeat(NAME_MAX_LENGTH + 1) },
    });
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(describedMessage(displayNameField())).toBe(
      DISPLAY_NAME_TOO_LONG_MESSAGE,
    );
    // The secret is untouched by the other field's failure.
    expect(secretField()).toHaveValue(SECRET_CODE);
  });

  it('clears the invite field message as soon as the field is edited', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await open(user);
    await user.click(submitControl());
    expect(describedMessage(secretField())).toBe(INVITE_SECRET_REQUIRED_MESSAGE);

    await user.type(secretField(), 'Z');

    expect(secretField()).not.toHaveAttribute('aria-invalid');
    expect(describedMessage(secretField())).toBeNull();
  });
});

describe('JoinSquadForm — an unusable invite or rejected name (Requirements 4.8, 4.9)', () => {
  it('renders the outcome in a live region, keeps every value, and stays submittable', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<Harness onSubmit={onSubmit} />);

    await open(user);
    await user.type(secretField(), SECRET_CODE);
    await user.type(displayNameField(), 'Dave');
    await user.click(submitControl());
    expect(onSubmit).toHaveBeenCalledOnce();

    rerender(<Harness onSubmit={onSubmit} outcomeMessage={INVITE_UNUSABLE} />);

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(INVITE_UNUSABLE);
    expect(region).toHaveAttribute('aria-live', 'polite');

    // 4.9: an outcome, not a field message — and nothing was cleared.
    expect(secretField()).not.toHaveAttribute('aria-invalid');
    expect(displayNameField()).not.toHaveAttribute('aria-invalid');
    expect(secretField()).toHaveValue(SECRET_CODE);
    expect(displayNameField()).toHaveValue('Dave');
    expect(submitControl()).not.toHaveAttribute('aria-disabled');

    await user.click(submitControl());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe('JoinSquadForm — the secret is not disclosed (Requirement 4.10)', () => {
  it('carries the secret in no rendered attribute but its own field value', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={vi.fn()} outcomeMessage={INVITE_UNUSABLE} />);

    await open(user);
    await user.type(secretField(), SECRET_CODE);
    await user.click(submitControl());

    // The value itself is where it should be…
    expect(secretField()).toHaveValue(SECRET_CODE);
    // …and nowhere else: no placeholder, title, aria-label, data attribute, id,
    // or rendered message repeats it.
    expect(disclosuresOf(SECRET_CODE)).toEqual([]);
  });

  it('carries a pasted link in no rendered attribute either', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={vi.fn()} />);

    await open(user);
    const link = `https://pitch-mate.co.uk/join/${SECRET_CODE}`;
    fireEvent.change(secretField(), { target: { value: link } });
    await user.click(submitControl());

    expect(disclosuresOf(link)).toEqual([]);
    expect(disclosuresOf(SECRET_CODE)).toEqual([]);
  });

  it('passes the secret to no logging function', async () => {
    const user = userEvent.setup();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {}),
    );

    render(<Harness onSubmit={vi.fn()} />);

    await open(user);
    await user.type(secretField(), SECRET_CODE);
    await user.click(submitControl());
    // Also the path where nothing is submitted, which is where a component might
    // be tempted to report what it refused.
    fireEvent.change(secretField(), { target: { value: '   ' } });
    await user.click(submitControl());

    const logged = spies.flatMap((spy) =>
      spy.mock.calls.flat().map((argument) => String(argument)),
    );

    expect(logged.some((entry) => entry.includes(SECRET_CODE))).toBe(false);
  });
});

describe('JoinSquadForm — a pending redemption (Requirement 4.5)', () => {
  it('issues no further redemption while a call awaits a response', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} pending />);

    await open(user);
    await user.type(secretField(), SECRET_CODE);
    await user.click(submitControl());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(submitControl()).toHaveAttribute('aria-disabled', 'true');
    expect(submitControl()).not.toBeDisabled();
  });
});
