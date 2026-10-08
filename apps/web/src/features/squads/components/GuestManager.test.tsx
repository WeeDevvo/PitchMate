/**
 * Unit tests for the Guest_Manager and the Guest_Form.
 *
 * They pin what these two components own: the create surface and its three
 * controls (Requirement 12.1), the trimmed submission (12.2), the blocked
 * submission and the message associated with the acknowledgement (12.3), the
 * acknowledgement unselected on every opening (12.4), the tier defaults and what
 * each selection puts into the command (12.5, 12.9), the edit surface's prefill
 * and its absent acknowledgement (12.7, 12.8), and the two outcome treatments —
 * a rejected display name with every entered value retained (12.11) and the
 * generic message with the list left alone (12.12).
 *
 * The api is a hand-written double implementing only the two methods these
 * surfaces reach, so what is asserted is the real command the real machine builds
 * — the tier codes come from `lib/skillTier.ts` through `useGuestManager`, not
 * from anything this file stubs.
 *
 * Focus entry and return, Escape, and the pending submit control belong to the
 * Form_Panel and are pinned by `FormPanel.test.tsx`.
 *
 * Feature: web-squads-screens
 */
import { useCallback, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  ADD_GUEST_HEADING,
  ADD_GUEST_SUBMIT_LABEL,
  DISPLAY_NAME_UNAVAILABLE,
  EDIT_GUEST_HEADING,
  GENERIC_SQUADS_FAILURE,
  GUEST_DISPLAY_NAME_LABEL,
  GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
  LAWFUL_BASIS_ACKNOWLEDGEMENT,
  LAWFUL_BASIS_REQUIRED_MESSAGE,
  SAVE_GUEST_SUBMIT_LABEL,
  SKILL_TIER_DO_NOT_SEED_LABEL,
  SKILL_TIER_LABEL,
  SKILL_TIER_LEAVE_UNCHANGED_LABEL,
  SKILL_TIER_STRONG_LABEL,
} from '../lib/messages';
import { ANONYMISED_PLACEHOLDER, type PlayerListRow } from '../lib/playerList';
import type { CreatedGuest } from '../lib/parse/createdGuest';
import { GuestManager } from './GuestManager';

const SQUAD_ID = '4f3d1f2e-0000-4000-8000-000000000001';
const GUEST_ID = '4f3d1f2e-0000-4000-8000-00000000000a';
const MEMBER_ID = '4f3d1f2e-0000-4000-8000-00000000000b';
const ERASED_GUEST_ID = '4f3d1f2e-0000-4000-8000-00000000000c';

/** One Player_List row, defaulted to an editable guest. */
function row(overrides: Partial<PlayerListRow> = {}): PlayerListRow {
  return {
    membershipId: GUEST_ID,
    displayName: 'Big Dave',
    role: null,
    state: 'Active',
    isGuest: true,
    appearances: 12,
    ratingState: 'Established',
    isFormerPlayer: false,
    leaderboardObtained: false,
    ratingEntry: null,
    ...overrides,
  };
}

const ROWS: readonly PlayerListRow[] = [
  row(),
  row({
    membershipId: MEMBER_ID,
    displayName: 'Registered Ruth',
    role: 'Member',
    isGuest: false,
    appearances: 12,
    ratingState: 'Established',
  }),
  row({
    membershipId: ERASED_GUEST_ID,
    displayName: ANONYMISED_PLACEHOLDER,
    isFormerPlayer: true,
  }),
];

interface ApiDouble {
  readonly api: SquadsApi;
  readonly createGuest: ReturnType<typeof vi.fn>;
  readonly editGuest: ReturnType<typeof vi.fn>;
}

function apiDouble(
  createResult: CallResult<CreatedGuest> = {
    kind: 'success',
    value: { guestMembershipId: GUEST_ID },
  },
  editResult: CallResult<void> = { kind: 'success', value: undefined },
): ApiDouble {
  const createGuest = vi.fn(async () => createResult);
  const editGuest = vi.fn(async () => editResult);

  return {
    api: { createGuest, editGuest } as unknown as SquadsApi,
    createGuest,
    editGuest,
  };
}

interface HarnessProps {
  readonly api: SquadsApi;
  readonly onSquadChanged?: (options?: { includeLeaderboard?: boolean }) => void;
  readonly editingMembershipId?: string | null;
}

/** The label of the harness control standing in for a Player_Row's edit action. */
const ROW_EDIT_LABEL = 'Edit guest: Big Dave';

/** The Squad_Screen's half of the wiring: it owns the edit target. */
function Harness({
  api,
  onSquadChanged = () => {},
  editingMembershipId = null,
}: HarnessProps): ReactElement {
  const [editing, setEditing] = useState<string | null>(editingMembershipId);
  const finish = useCallback(() => setEditing(null), []);

  return (
    <div>
      {/* The Player_Row's edit control lives outside this section, so the target
          arrives as a prop exactly as it will from the Squad_Screen. */}
      <button type="button" onClick={() => setEditing(GUEST_ID)}>
        {ROW_EDIT_LABEL}
      </button>
      <GuestManager
        squadId={SQUAD_ID}
        api={api}
        rows={ROWS}
        editingMembershipId={editing}
        onEditingFinished={finish}
        onSquadChanged={onSquadChanged}
      />
    </div>
  );
}

const nameField = (): HTMLInputElement =>
  screen.getByLabelText(GUEST_DISPLAY_NAME_LABEL) as HTMLInputElement;

const tierSelect = (): HTMLSelectElement =>
  screen.getByLabelText(SKILL_TIER_LABEL) as HTMLSelectElement;

const acknowledgement = (): HTMLInputElement =>
  screen.getByLabelText(LAWFUL_BASIS_ACKNOWLEDGEMENT) as HTMLInputElement;

/** The message text programmatically associated with a control, or `null`. */
function describedMessage(control: HTMLElement): string | null {
  const id = control.getAttribute('aria-describedby');

  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

async function openCreate(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: ADD_GUEST_HEADING }));
}

describe('GuestForm create mode — the three labelled controls (Requirements 12.1, 12.4, 12.5)', () => {
  it('opens with an empty name, no tier seeded, and the acknowledgement unselected', async () => {
    const user = userEvent.setup();
    render(<Harness api={apiDouble().api} />);

    await openCreate(user);

    expect(screen.getByText(GUEST_DISPLAY_NAME_LABEL)).toBeVisible();
    expect(screen.getByText(SKILL_TIER_LABEL)).toBeVisible();
    expect(screen.getByText(LAWFUL_BASIS_ACKNOWLEDGEMENT)).toBeVisible();

    expect(nameField().value).toBe('');
    // 12.5: exactly three tiers plus the option to seed none, defaulted to none.
    expect(tierSelect().options).toHaveLength(4);
    expect(
      tierSelect().options[tierSelect().selectedIndex]?.textContent,
    ).toBe(SKILL_TIER_DO_NOT_SEED_LABEL);
    expect(acknowledgement().checked).toBe(false);
  });

  it('renders the acknowledgement unselected on every opening (Requirement 12.4)', async () => {
    const user = userEvent.setup();
    render(<Harness api={apiDouble().api} />);

    await openCreate(user);
    await user.click(acknowledgement());
    expect(acknowledgement().checked).toBe(true);

    await user.keyboard('{Escape}');
    await openCreate(user);

    // A fresh opening is a fresh act: the previous guest's acknowledgement is
    // not inherited, and neither is their name or tier.
    expect(acknowledgement().checked).toBe(false);
    expect(nameField().value).toBe('');
  });
});

describe('GuestForm create mode — what blocks a call (Requirements 12.2, 12.3)', () => {
  it('issues no CreateGuest without the acknowledgement and states it against that control', async () => {
    const user = userEvent.setup();
    const { api, createGuest } = apiDouble();
    render(<Harness api={api} />);

    await openCreate(user);
    await user.type(nameField(), 'Big Dave');
    await user.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));

    expect(createGuest).not.toHaveBeenCalled();
    expect(describedMessage(acknowledgement())).toBe(
      LAWFUL_BASIS_REQUIRED_MESSAGE,
    );
    // Every entered value is retained, and the control stays available.
    expect(nameField().value).toBe('Big Dave');
  });

  it('issues no CreateGuest for a whitespace-only display name', async () => {
    const user = userEvent.setup();
    const { api, createGuest } = apiDouble();
    render(<Harness api={api} />);

    await openCreate(user);
    await user.type(nameField(), '   ');
    await user.click(acknowledgement());
    await user.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));

    expect(createGuest).not.toHaveBeenCalled();
    expect(describedMessage(nameField())).toBe(
      GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
    );
  });
});

describe('GuestForm create mode — the submitted command (Requirements 12.2, 12.5, 12.6)', () => {
  it('submits the trimmed name with the acknowledgement and no tier while the default is selected', async () => {
    const user = userEvent.setup();
    const onSquadChanged = vi.fn();
    const { api, createGuest } = apiDouble();
    render(<Harness api={api} onSquadChanged={onSquadChanged} />);

    await openCreate(user);
    await user.type(nameField(), '  Big Dave  ');
    await user.click(acknowledgement());
    await user.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));

    await waitFor(() => expect(createGuest).toHaveBeenCalledTimes(1));

    const [squadId, command] = createGuest.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(squadId).toBe(SQUAD_ID);
    expect(command.displayName).toBe('Big Dave');
    expect(command.lawfulBasisAcknowledged).toBe(true);
    // 12.5: the property is absent, not `undefined` — the default seeds no tier.
    expect('skillTier' in command).toBe(false);

    // 12.6: the recomposed Player_List comes from one further `GetSquad` and one
    // further `GetSquadLeaderboard`, forced because a new guest may appear on it.
    await waitFor(() =>
      expect(onSquadChanged).toHaveBeenCalledWith({ includeLeaderboard: true }),
    );
    // The panel closes on success.
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: ADD_GUEST_HEADING }),
      ).not.toBeInTheDocument(),
    );
  });

  it('submits the selected tier as its member name', async () => {
    const user = userEvent.setup();
    const { api, createGuest } = apiDouble();
    render(<Harness api={api} />);

    await openCreate(user);
    await user.type(nameField(), 'Strong Steve');
    await user.selectOptions(tierSelect(), [
      screen.getByRole('option', { name: SKILL_TIER_STRONG_LABEL }),
    ]);
    await user.click(acknowledgement());
    await user.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));

    await waitFor(() => expect(createGuest).toHaveBeenCalledTimes(1));

    const [, command] = createGuest.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // The `SkillTier` member name for the strongest tier, produced by
    // `lib/skillTier.ts` through the machine — no component names an enum code.
    expect(command.skillTier).toBe('Strong');
  });
});

describe('GuestForm create mode — the two outcome treatments (Requirements 12.11, 12.12)', () => {
  it('reports a rejected display name and keeps every entered value', async () => {
    const user = userEvent.setup();
    const { api, createGuest } = apiDouble({
      kind: 'rejected-input',
      reason: 'display-name-in-use',
    });
    render(<Harness api={api} />);

    await openCreate(user);
    await user.type(nameField(), 'Big Dave');
    await user.selectOptions(tierSelect(), [
      screen.getByRole('option', { name: SKILL_TIER_STRONG_LABEL }),
    ]);
    await user.click(acknowledgement());
    await user.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));

    await waitFor(() =>
      expect(screen.getByText(DISPLAY_NAME_UNAVAILABLE)).toBeInTheDocument(),
    );

    expect(createGuest).toHaveBeenCalledTimes(1);
    expect(nameField().value).toBe('Big Dave');
    expect(
      tierSelect().options[tierSelect().selectedIndex]?.textContent,
    ).toBe(SKILL_TIER_STRONG_LABEL);
    expect(acknowledgement().checked).toBe(true);
    // Available for a further submission.
    expect(
      screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('reports the generic message for a failed call and triggers no re-read', async () => {
    const user = userEvent.setup();
    const onSquadChanged = vi.fn();
    const { api } = apiDouble({ kind: 'transport-failure' });
    render(<Harness api={api} onSquadChanged={onSquadChanged} />);

    await openCreate(user);
    await user.type(nameField(), 'Big Dave');
    await user.click(acknowledgement());
    await user.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));

    await waitFor(() =>
      expect(screen.getByText(GENERIC_SQUADS_FAILURE)).toBeInTheDocument(),
    );
    expect(onSquadChanged).not.toHaveBeenCalled();
  });
});

describe('GuestForm edit mode — the prefill, the defaults, and the command (Requirements 12.7–12.10)', () => {
  it('opens prefilled, leaves the tier unchanged, and renders no acknowledgement control', () => {
    render(<Harness api={apiDouble().api} editingMembershipId={GUEST_ID} />);

    expect(
      screen.getByRole('group', { name: EDIT_GUEST_HEADING }),
    ).toBeInTheDocument();
    expect(nameField().value).toBe('Big Dave');
    expect(
      tierSelect().options[tierSelect().selectedIndex]?.textContent,
    ).toBe(SKILL_TIER_LEAVE_UNCHANGED_LABEL);
    // 12.8: absent altogether, not merely unselected.
    expect(
      screen.queryByLabelText(LAWFUL_BASIS_ACKNOWLEDGEMENT),
    ).not.toBeInTheDocument();
  });

  it('submits EditGuest for that membership without overwriting the tier', async () => {
    const user = userEvent.setup();
    const onSquadChanged = vi.fn();
    const { api, editGuest } = apiDouble();
    render(
      <Harness
        api={api}
        onSquadChanged={onSquadChanged}
        editingMembershipId={GUEST_ID}
      />,
    );

    await user.clear(nameField());
    await user.type(nameField(), ' Bigger Dave ');
    await user.click(screen.getByRole('button', { name: SAVE_GUEST_SUBMIT_LABEL }));

    await waitFor(() => expect(editGuest).toHaveBeenCalledTimes(1));

    const [squadId, membershipId, command] = editGuest.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(squadId).toBe(SQUAD_ID);
    expect(membershipId).toBe(GUEST_ID);
    expect(command.displayName).toBe('Bigger Dave');
    // 12.9: the tier is not to be changed, and no value that could overwrite it
    // is carried.
    expect(command.updateSkillTier).toBe(false);
    expect('skillTier' in command).toBe(false);

    // 12.10: exactly one further `GetSquad`, and no forced leaderboard call.
    await waitFor(() => expect(onSquadChanged).toHaveBeenCalledWith());
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: EDIT_GUEST_HEADING }),
      ).not.toBeInTheDocument(),
    );
  });

  it('opens the edit form again for a further edit after one has succeeded', async () => {
    const user = userEvent.setup();
    const { api, editGuest } = apiDouble();
    render(<Harness api={api} editingMembershipId={GUEST_ID} />);

    await user.click(screen.getByRole('button', { name: SAVE_GUEST_SUBMIT_LABEL }));
    await waitFor(() => expect(editGuest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: EDIT_GUEST_HEADING }),
      ).not.toBeInTheDocument(),
    );

    // A settled outcome must not keep the next form shut.
    await user.click(screen.getByRole('button', { name: ROW_EDIT_LABEL }));

    expect(
      screen.getByRole('group', { name: EDIT_GUEST_HEADING }),
    ).toBeInTheDocument();
    expect(nameField().value).toBe('Big Dave');
  });

  it('keeps the edit form open with its value after a rejected display name', async () => {
    const user = userEvent.setup();
    const { api } = apiDouble(undefined, {
      kind: 'rejected-input',
      reason: 'display-name-in-use',
    });
    render(<Harness api={api} editingMembershipId={GUEST_ID} />);

    await user.clear(nameField());
    await user.type(nameField(), 'Registered Ruth');
    await user.click(screen.getByRole('button', { name: SAVE_GUEST_SUBMIT_LABEL }));

    await waitFor(() =>
      expect(screen.getByText(DISPLAY_NAME_UNAVAILABLE)).toBeInTheDocument(),
    );
    expect(nameField().value).toBe('Registered Ruth');
  });

  it.each([
    ['a registered membership', MEMBER_ID],
    ['a Former_Player', ERASED_GUEST_ID],
  ])('opens no edit form for %s (Requirement 12.7)', (_case, membershipId) => {
    const { unmount } = render(
      <Harness api={apiDouble().api} editingMembershipId={membershipId} />,
    );

    // The predicate is asked a second time here, so a target the row would never
    // have offered opens nothing even when a caller supplies it.
    expect(
      screen.queryByRole('group', { name: EDIT_GUEST_HEADING }),
    ).not.toBeInTheDocument();

    unmount();
  });
});
