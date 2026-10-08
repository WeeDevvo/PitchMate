/**
 * Property test for the guest commands the Guest_Form emits (task 12.5).
 *
 * **Property 30: Guest commands carry exactly the acknowledged, trimmed, and
 * selected values.** *For any* display name and acknowledgement state, a
 * `CreateGuest` call is issued exactly when the display name is non-empty after
 * trimming and the acknowledgement is given, and carries the trimmed display
 * name; *for any* skill-tier selection the created command omits the tier exactly
 * when the no-tier option is selected and otherwise carries that tier's code; and
 * *for any* edit selection the edit command reports that the tier is to be changed
 * exactly when a tier option other than "leave unchanged" is selected and carries
 * a tier value only then.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 12.2 — a call exactly when the trimmed name is non-empty and within the bound, and the acknowledgement is given | {@link expectCreateCall} |
 * | 12.2 — the submitted name is the trimmed one | {@link expectCreateCall}, {@link expectEditCall} |
 * | 12.5 — the tier is omitted exactly while the no-tier default is selected, and otherwise carries that tier's **member name** | {@link expectedCreateCommand}, {@link expectNoTierCodeOutOfRange} |
 * | 12.9 — an edit states whether the tier changes and carries a tier only then | {@link expectedEditCommand} |
 *
 * ### The command is read at the api seam, not off the form
 *
 * The form emits a tagged submission carrying the tier **selection**;
 * `useGuestManager` and `lib/skillTier.ts` are what turn that into the wire body.
 * So every assertion below reads the arguments of the `createGuest` / `editGuest`
 * double — the real machine's real command, built by the real mapping. That is
 * what makes the vocabulary claim meaningful: the wire values `Beginner`,
 * `Average`, `Strong` are written out *here*, independently of
 * `lib/wireEnums.ts`, so a casing or vocabulary drift in that module fails this
 * property rather than being restated by it.
 * {@link expectNoTierCodeOutOfRange} adds the reading that catches the same
 * drift from the other side: no command ever carries a numeric code or a
 * lower-cased name, which is what the retired code table used to emit.
 *
 * ### Why the field is set rather than typed, and why the expectation is read back
 *
 * The display-name field carries the backend's own `maxlength`, which a keystroke
 * driver honours — so *typing* 101 characters could only ever produce 100 and the
 * over-long case the task asks for would quietly never be exercised. The value is
 * therefore set with a change event, which is also how a paste of an over-long
 * name arrives, and the rule under test is the one applied on **submission**.
 *
 * The expectation is then computed from the field's value *after* the change
 * rather than from the generated string, because an `<input>` sanitises its value
 * (line breaks, for one). Reading it back keeps the property a claim about what a
 * person can actually have in the field, and the trimming and the length bound are
 * applied here from the requirement's own words rather than by calling the
 * feature's validator.
 *
 * Neither call is allowed to settle: both doubles return a promise that never
 * resolves, so each run observes exactly the command that was issued and nothing
 * of the outcome handling — which belongs to `GuestManager.test.tsx`.
 *
 * Feature: web-squads-screens, Property 30: Guest commands carry exactly the acknowledged, trimmed, and selected values
 * Validates: Requirements 12.2, 12.5, 12.9
 */
import { useCallback, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';

import type { SquadsApi } from '../api/squadsApi';
import {
  ADD_GUEST_SUBMIT_LABEL,
  GUEST_DISPLAY_NAME_LABEL,
  SAVE_GUEST_SUBMIT_LABEL,
} from '../lib/messages';
import type { PlayerListRow } from '../lib/playerList';
import {
  GUEST_FORM_ACKNOWLEDGEMENT_SELECTOR,
  GUEST_FORM_TIER_SELECTOR,
} from './GuestForm';
import { GuestManager, GUEST_MANAGER_ADD_SELECTOR } from './GuestManager';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
const GUEST_MEMBERSHIP_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f0a';

/**
 * The Player_Display_Name bound, from Requirement 3.4's wording rather than from
 * `lib/nameValidation.ts` — a property that read the bound out of the module it
 * constrains would accept any bound that module happened to hold.
 */
const DISPLAY_NAME_MAX_LENGTH = 100;

/**
 * The `SkillTier` wire values, written out independently of `lib/wireEnums.ts`
 * (Requirements 12.5, 16.6).
 *
 * The backend serialises each tier as its **member name verbatim**, so the wire
 * value is the C# member name and nothing else. Stating it here rather than
 * reading it from the module under test is what makes the claim an oracle: a
 * casing or vocabulary drift in that module fails this property rather than
 * agreeing with itself.
 */
const EXPECTED_TIER_WIRE_VALUE: Readonly<Record<TierName, string>> = {
  Beginner: 'Beginner',
  Average: 'Average',
  Strong: 'Strong',
};

/**
 * Values the retired numeric code table, or a lower-cased reading of the names,
 * would have produced — and which no command may ever carry.
 */
const VALUES_NO_TIER_HAS: readonly unknown[] = [
  0,
  1,
  2,
  3,
  'beginner',
  'average',
  'strong',
];

/** The three Skill_Tiers, by the names the option model uses. */
type TierName = 'Beginner' | 'Average' | 'Strong';

/** The create-mode selection: the three tiers, plus the option to seed none. */
type CreateTierOption = TierName | 'do-not-seed';

/** The edit-mode selection: the three tiers, plus leaving the tier unchanged. */
type EditTierOption = TierName | 'leave-unchanged';

const TIER_NAMES: readonly TierName[] = ['Beginner', 'Average', 'Strong'];

// --- Generators ---------------------------------------------------------------

/**
 * The display names the task asks for by name: **0, 1, 100, and 101 characters**,
 * whitespace-only in more than one shape, and a name whose *trimmed* length is
 * exactly the bound while its entered length is over it — the case that tells a
 * bound applied before trimming from one applied after.
 */
const FIXED_NAMES: readonly string[] = [
  '',
  'D',
  'x'.repeat(DISPLAY_NAME_MAX_LENGTH),
  'x'.repeat(DISPLAY_NAME_MAX_LENGTH + 1),
  ' ',
  '   ',
  '\t \t',
  `  ${'x'.repeat(DISPLAY_NAME_MAX_LENGTH)}  `,
  ` ${'x'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)} `,
  '  Big Dave  ',
  'Big Dave',
  'BigDave',
  "Síobhán O'Neill",
  '日本語の名前',
];

const enteredNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...FIXED_NAMES) },
  {
    weight: 2,
    // Around the bound in both directions, so the accepted and rejected sides are
    // both reached by generated values rather than only by the fixed pool.
    arbitrary: fc
      .integer({ min: 0, max: DISPLAY_NAME_MAX_LENGTH + 4 })
      .map((length) => 'a'.repeat(length)),
  },
  {
    weight: 2,
    arbitrary: fc.string({ minLength: 0, maxLength: 30, unit: 'grapheme' }),
  },
  {
    weight: 1,
    arbitrary: fc
      .string({ minLength: 0, maxLength: 12, unit: 'grapheme' })
      .map((value) => `  ${value}\t`),
  },
);

const createTierArb: fc.Arbitrary<CreateTierOption> =
  fc.constantFrom<CreateTierOption>('do-not-seed', ...TIER_NAMES);

const editTierArb: fc.Arbitrary<EditTierOption> =
  fc.constantFrom<EditTierOption>('leave-unchanged', ...TIER_NAMES);

interface CreateCase {
  readonly entered: string;
  readonly acknowledged: boolean;
  readonly tier: CreateTierOption;
}

const createCaseArb: fc.Arbitrary<CreateCase> = fc.record({
  entered: enteredNameArb,
  acknowledged: fc.boolean(),
  tier: createTierArb,
});

interface EditCase {
  readonly entered: string;
  readonly tier: EditTierOption;
}

const editCaseArb: fc.Arbitrary<EditCase> = fc.record({
  entered: enteredNameArb,
  tier: editTierArb,
});

// --- The harness --------------------------------------------------------------

interface ApiDouble {
  readonly api: SquadsApi;
  readonly createGuest: ReturnType<typeof vi.fn>;
  readonly editGuest: ReturnType<typeof vi.fn>;
}

/**
 * An api whose two guest calls never settle.
 *
 * Nothing here decides an outcome: the property is about the command that was
 * issued, and a call left awaiting a response leaves no late state update to
 * interleave with the next generated run.
 */
function apiDouble(): ApiDouble {
  const pending = (): Promise<never> => new Promise<never>(() => {});
  const createGuest = vi.fn(pending);
  const editGuest = vi.fn(pending);

  return {
    api: { createGuest, editGuest } as unknown as SquadsApi,
    createGuest,
    editGuest,
  };
}

/** The one guest row the edit mode targets, prefilling a name to be replaced. */
const GUEST_ROW: PlayerListRow = {
  membershipId: GUEST_MEMBERSHIP_ID,
  displayName: 'Big Dave',
  role: null,
  state: 'Active',
  isGuest: true,
  appearances: 12,
  ratingState: 'Established',
  isFormerPlayer: false,
  leaderboardObtained: false,
  ratingEntry: null,
};

interface HarnessProps {
  readonly api: SquadsApi;
  readonly editingMembershipId?: string | null;
}

/** The Squad_Screen's half of the wiring: it owns the edit target. */
function Harness({
  api,
  editingMembershipId = null,
}: HarnessProps): ReactElement {
  const [editing, setEditing] = useState<string | null>(editingMembershipId);
  const finish = useCallback(() => setEditing(null), []);

  return (
    <GuestManager
      squadId={SQUAD_ID}
      api={api}
      rows={[GUEST_ROW]}
      editingMembershipId={editing}
      onEditingFinished={finish}
      onSquadChanged={() => {}}
    />
  );
}

/** A pointer driver with no artificial delay, so the runs stay quick. */
function formUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText(GUEST_DISPLAY_NAME_LABEL) as HTMLInputElement;
}

function tierSelect(container: HTMLElement): HTMLSelectElement {
  const selects = container.querySelectorAll<HTMLSelectElement>(
    GUEST_FORM_TIER_SELECTOR,
  );

  expect(selects).toHaveLength(1);

  return selects[0];
}

/**
 * Put a value into the display-name field and hand back what the field then
 * holds — which is what the submission will read, `maxlength` bypassed and the
 * `<input>`'s own value sanitisation applied.
 */
function enterDisplayName(value: string): string {
  const field = nameField();

  fireEvent.change(field, { target: { value } });

  return field.value;
}

// --- The expectations ---------------------------------------------------------

/**
 * Requirement 12.2: whether this entered name is one a call may be issued for —
 * non-empty after trimming and no longer than the bound, both applied to the
 * *trimmed* value.
 */
function isAcceptedName(entered: string): boolean {
  const trimmed = entered.trim();

  return trimmed.length > 0 && trimmed.length <= DISPLAY_NAME_MAX_LENGTH;
}

/** The exact `CreateGuest` body a case must produce (Requirements 12.2, 12.5). */
function expectedCreateCommand(
  entered: string,
  tier: CreateTierOption,
): Record<string, unknown> {
  const command: Record<string, unknown> = {
    // 12.2: the trimmed name, never the entered one.
    displayName: entered.trim(),
    // 12.2: reached only while the acknowledgement is given, so always `true`.
    lawfulBasisAcknowledged: true,
  };

  // 12.5: the default seeds no tier, so the property is absent altogether.
  if (tier !== 'do-not-seed') {
    command.skillTier = EXPECTED_TIER_WIRE_VALUE[tier];
  }

  return command;
}

/** The exact `EditGuest` body a case must produce (Requirements 12.2, 12.9). */
function expectedEditCommand(
  entered: string,
  tier: EditTierOption,
): Record<string, unknown> {
  // 12.9: the flag is always stated; the tier is carried only when it changes.
  if (tier === 'leave-unchanged') {
    return { displayName: entered.trim(), updateSkillTier: false };
  }

  return {
    displayName: entered.trim(),
    updateSkillTier: true,
    skillTier: EXPECTED_TIER_WIRE_VALUE[tier],
  };
}

/**
 * The command carries exactly the expected fields — no extra property, and an
 * omitted tier omitted rather than set to `undefined`.
 *
 * `toEqual` alone would accept `{ skillTier: undefined }` as an absence, which is
 * precisely the distinction Requirements 12.5 and 12.9 rest on, so the key set is
 * compared as well.
 */
function expectCommandIsExactly(
  command: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  expect(command).toEqual(expected);
  expect(Object.keys(command).sort()).toEqual(Object.keys(expected).sort());
}

/**
 * Requirements 12.5, 12.9, 16.6: any tier a command carries is one of the three
 * member names, and never a numeric code or a lower-cased reading of a name.
 */
function expectNoTierCodeOutOfRange(command: Record<string, unknown>): void {
  if (!('skillTier' in command)) {
    return;
  }

  expect(VALUES_NO_TIER_HAS).not.toContain(command.skillTier);
  expect(Object.values(EXPECTED_TIER_WIRE_VALUE)).toContain(command.skillTier);
}

/**
 * Requirements 12.2, 12.5: a `CreateGuest` call was issued exactly when the name
 * is accepted and the acknowledgement given, and it carries exactly the expected
 * body for this squad.
 */
function expectCreateCall(
  createGuest: ReturnType<typeof vi.fn>,
  entered: string,
  testCase: CreateCase,
): void {
  const shouldIssue = isAcceptedName(entered) && testCase.acknowledged;

  expect(createGuest).toHaveBeenCalledTimes(shouldIssue ? 1 : 0);

  if (!shouldIssue) {
    return;
  }

  const [squadId, command] = createGuest.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];

  expect(squadId).toBe(SQUAD_ID);
  expectCommandIsExactly(command, expectedCreateCommand(entered, testCase.tier));
  expectNoTierCodeOutOfRange(command);
}

/**
 * Requirements 12.2, 12.9: an `EditGuest` call was issued exactly when the name is
 * accepted, for that membership identity, carrying exactly the expected body.
 */
function expectEditCall(
  editGuest: ReturnType<typeof vi.fn>,
  entered: string,
  testCase: EditCase,
): void {
  const shouldIssue = isAcceptedName(entered);

  expect(editGuest).toHaveBeenCalledTimes(shouldIssue ? 1 : 0);

  if (!shouldIssue) {
    return;
  }

  const [squadId, membershipId, command] = editGuest.mock.calls[0] as [
    string,
    string,
    Record<string, unknown>,
  ];

  expect(squadId).toBe(SQUAD_ID);
  expect(membershipId).toBe(GUEST_MEMBERSHIP_ID);
  expectCommandIsExactly(command, expectedEditCommand(entered, testCase.tier));
  expectNoTierCodeOutOfRange(command);
}

// --- The property -------------------------------------------------------------

describe('Property 30 — guest commands carry exactly the acknowledged, trimmed, and selected values', () => {
  // Feature: web-squads-screens, Property 30: Guest commands carry exactly the acknowledged, trimmed, and selected values
  // Validates: Requirements 12.2, 12.5
  it('issues CreateGuest exactly for an acknowledged, non-empty, in-bound name and carries the trimmed name and the selected tier code', async () => {
    await fc.assert(
      fc.asyncProperty(createCaseArb, async (testCase) => {
        const user = formUser();
        const { api, createGuest } = apiDouble();
        const { container } = render(<Harness api={api} />);

        try {
          const addControl = container.querySelector<HTMLElement>(
            GUEST_MANAGER_ADD_SELECTOR,
          );
          expect(addControl).not.toBeNull();
          await user.click(addControl as HTMLElement);

          const entered = enterDisplayName(testCase.entered);

          await user.selectOptions(tierSelect(container), testCase.tier);

          const acknowledgement = container.querySelector<HTMLInputElement>(
            GUEST_FORM_ACKNOWLEDGEMENT_SELECTOR,
          );
          // 12.1, 12.8: the control exists in `create` mode, and only there.
          expect(acknowledgement).not.toBeNull();

          if (testCase.acknowledged) {
            await user.click(acknowledgement as HTMLInputElement);
          }
          expect((acknowledgement as HTMLInputElement).checked).toBe(
            testCase.acknowledged,
          );

          await user.click(
            screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }),
          );

          expectCreateCall(createGuest, entered, testCase);
          // The command is the only call either way: nothing else is issued.
          expect(createGuest.mock.calls.length).toBeLessThanOrEqual(1);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 150 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 30: Guest commands carry exactly the acknowledged, trimmed, and selected values
  // Validates: Requirements 12.2, 12.9
  it('issues EditGuest reporting whether the tier changes and carrying a tier only then', async () => {
    await fc.assert(
      fc.asyncProperty(editCaseArb, async (testCase) => {
        const user = formUser();
        const { api, editGuest } = apiDouble();
        const { container } = render(
          <Harness api={api} editingMembershipId={GUEST_MEMBERSHIP_ID} />,
        );

        try {
          // 12.8: no acknowledgement control exists on an edit, so there is
          // nothing for a submission to depend on beyond the name.
          expect(
            container.querySelectorAll(GUEST_FORM_ACKNOWLEDGEMENT_SELECTOR),
          ).toHaveLength(0);

          const entered = enterDisplayName(testCase.entered);

          await user.selectOptions(tierSelect(container), testCase.tier);
          await user.click(
            screen.getByRole('button', { name: SAVE_GUEST_SUBMIT_LABEL }),
          );

          expectEditCall(editGuest, entered, testCase);
          expect(editGuest.mock.calls.length).toBeLessThanOrEqual(1);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 150 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 30: Guest commands carry exactly the acknowledged, trimmed, and selected values
  // Validates: Requirements 12.5, 12.9
  it('sends no skill-tier value outside the three member names, in either mode', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TIER_NAMES),
        async (tier) => {
          const user = formUser();
          const { api, createGuest, editGuest } = apiDouble();

          const created = render(<Harness api={api} />);
          try {
            const addControl = created.container.querySelector<HTMLElement>(
              GUEST_MANAGER_ADD_SELECTOR,
            );
            await user.click(addControl as HTMLElement);
            enterDisplayName('Tiered Terry');
            await user.selectOptions(tierSelect(created.container), tier);
            await user.click(
              created.container.querySelector<HTMLInputElement>(
                GUEST_FORM_ACKNOWLEDGEMENT_SELECTOR,
              ) as HTMLInputElement,
            );
            await user.click(
              screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }),
            );
          } finally {
            cleanup();
          }

          const edited = render(
            <Harness api={api} editingMembershipId={GUEST_MEMBERSHIP_ID} />,
          );
          try {
            enterDisplayName('Tiered Terry');
            await user.selectOptions(tierSelect(edited.container), tier);
            await user.click(
              screen.getByRole('button', { name: SAVE_GUEST_SUBMIT_LABEL }),
            );
          } finally {
            cleanup();
          }

          const commands = [
            ...createGuest.mock.calls.map(
              (call) => (call as unknown[])[1] as Record<string, unknown>,
            ),
            ...editGuest.mock.calls.map(
              (call) => (call as unknown[])[2] as Record<string, unknown>,
            ),
          ];

          expect(commands).toHaveLength(2);

          for (const command of commands) {
            // Both modes carried the tier, and both carried the same member name
            // — the retired code table would have put a number here.
            expect(command.skillTier).toBe(EXPECTED_TIER_WIRE_VALUE[tier]);
            expectNoTierCodeOutOfRange(command);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);
});
