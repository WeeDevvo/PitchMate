/**
 * Property test for the guest edit affordance (task 12.5).
 *
 * **Property 31: The guest edit affordance appears exactly on editable guest
 * rows.** *For any* Squad_Member and caller holding Admin_Authority, the guest
 * edit control is rendered exactly when the guest flag is set and the display name
 * is not the anonymised placeholder, and the edit form opens prefilled with that
 * guest's display name, with the leave-unchanged tier option selected, and with no
 * lawful-basis acknowledgement control.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 12.7 — the control on exactly the guest rows that are not the Anonymised_Placeholder, and on no row whose Guest_Flag is unset | {@link expectAffordanceSetIsExact} |
 * | 12.7 — a target the predicate rejects opens nothing, even when a caller hands it over | the second property below |
 * | 12.8 — the opened form is prefilled with *that* guest's name | {@link expectEditFormFor} |
 * | 12.8 — the tier selection offers "leave unchanged" and it is selected | {@link expectEditFormFor} |
 * | 12.8 — no Lawful_Basis_Acknowledgement control on an edit | {@link expectEditFormFor} |
 *
 * ### The affordance is on the row, and the predicate is applied twice
 *
 * Requirement 12.7 puts the control on each Player_Row, so the property renders the
 * real {@link PlayerList} beside the real {@link GuestManager}, wired the way the
 * Squad_Screen wires them: the row hands its membership identity up, the harness
 * holds it, and it arrives back as the manager's edit target. Both halves are
 * therefore exercised — the set of rendered controls, and the second application
 * of the same predicate to the target the manager is handed.
 *
 * That second application is what the file's other property is about. A caller can
 * supply any identity, and the manager must open a form only for one the predicate
 * accepts: a registered membership, a Former_Player, and an identity the list does
 * not hold at all must all open nothing and issue nothing.
 *
 * ### Every row is parsed and composed, never hand-built
 *
 * Each case is a generated `GetSquad` body put through `parseSquadDetail` and
 * `composePlayerList`, so the guest flag and the role absence under test are the
 * ones the backend actually serialises, and `isFormerPlayer` is **derived** by the
 * composition rather than asserted into place. Each generated name carries its own
 * independent verdict on whether it is the placeholder, and that verdict is checked
 * against the composed row — so a composition that stopped recognising
 * `'Former player'` fails here instead of letting the affordance claim pass
 * vacuously.
 *
 * The viewer holds Admin_Authority on most runs, because the affordance can only be
 * absent-for-the-right-reason where it could otherwise have appeared; the runs
 * without it pin the other direction, that no row offers the control at all.
 *
 * Feature: web-squads-screens, Property 31: The guest edit affordance appears exactly on editable guest rows
 * Validates: Requirements 12.7, 12.8
 */
import { useCallback, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fc from 'fast-check';

import type { SquadsApi } from '../api/squadsApi';
import {
  codeFromMemberRole,
  codeFromMembershipState,
  type MemberRole,
  type MembershipStateValue,
} from '../lib/enumCodes';
import {
  EDIT_GUEST_HEADING,
  EDIT_GUEST_LABEL,
  GUEST_DISPLAY_NAME_LABEL,
  SKILL_TIER_DO_NOT_SEED_LABEL,
  SKILL_TIER_LEAVE_UNCHANGED_LABEL,
} from '../lib/messages';
import { parseSquadDetail } from '../lib/parse/squadDetail';
import { composePlayerList, type PlayerListRow } from '../lib/playerList';
import {
  GUEST_FORM_ACKNOWLEDGEMENT_SELECTOR,
  GUEST_FORM_TIER_SELECTOR,
} from './GuestForm';
import { GuestManager } from './GuestManager';
import { PlayerList } from './PlayerList';
import {
  PLAYER_ROW_EDIT_GUEST_SELECTOR,
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_SELECTOR,
  type ViewerContext,
} from './PlayerRow';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
const VIEWER_MEMBERSHIP_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
/** An identity no generated row ever carries, for the absent-target case. */
const UNKNOWN_MEMBERSHIP_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7fee';

/** The edit-mode tier option identifier, as the control reports it. */
const LEAVE_UNCHANGED_VALUE = 'leave-unchanged';

// --- Generators ---------------------------------------------------------------

/**
 * A Player_Display_Name together with an **independent** verdict on whether it is
 * the Anonymised_Placeholder — carried by the generator rather than recomputed
 * from the predicate under test.
 *
 * Both directions matter here: a name wrongly read as the placeholder costs a real
 * guest its edit control, and one wrongly read as a name gives an erased guest an
 * affordance there is no longer a person for. So the pool is built around the
 * placeholder's edges — padded forms, which recognition trims and therefore
 * accepts, against case, interior-whitespace, and near-miss forms, which it must
 * not. No line break appears in any name, so what a text field holds is exactly
 * what was parsed.
 */
interface NameCase {
  readonly value: string;
  readonly isPlaceholder: boolean;
}

const PLACEHOLDER_NAMES: readonly string[] = [
  'Former player',
  ' Former player',
  'Former player ',
  '   Former player   ',
  '\tFormer player\t',
];

const NEAR_MISS_NAMES: readonly string[] = [
  'former player',
  'FORMER PLAYER',
  'Former  player',
  'Former players',
  'Formerplayer',
  'Former',
  'player',
];

const ORDINARY_NAMES: readonly string[] = [
  'Dave',
  'BigDave',
  "Síobhán O'Neill",
  'Ali',
  '日本語の名前',
  'A',
];

const nameCaseArb: fc.Arbitrary<NameCase> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .constantFrom(...PLACEHOLDER_NAMES)
      .map((value) => ({ value, isPlaceholder: true })),
  },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom(...NEAR_MISS_NAMES)
      .map((value) => ({ value, isPlaceholder: false })),
  },
  {
    weight: 3,
    arbitrary: fc
      .constantFrom(...ORDINARY_NAMES)
      .map((value) => ({ value, isPlaceholder: false })),
  },
  {
    weight: 2,
    // Letters, numbers, punctuation, and single interior spaces only, so the
    // rendered name, the control's accessible name, and the prefilled field value
    // all collapse identically — exotic whitespace would make those comparisons a
    // coin toss rather than a claim about the row.
    arbitrary: fc
      .string({ minLength: 1, maxLength: 30, unit: 'grapheme' })
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(
        (value) =>
          value.length > 0 &&
          /^[\p{L}\p{N}\p{P} ]+$/u.test(value) &&
          value !== 'Former player',
      )
      .map((value) => ({ value, isPlaceholder: false })),
  },
);

/** How the wire body carries the role: as a code, as `null`, or not at all. */
type RoleForm =
  | { readonly kind: 'present'; readonly value: MemberRole }
  | { readonly kind: 'null' }
  | { readonly kind: 'absent' };

const roleFormArb: fc.Arbitrary<RoleForm> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .constantFrom<MemberRole>('owner', 'admin', 'member')
      .map((value) => ({ kind: 'present', value }) as RoleForm),
  },
  { weight: 2, arbitrary: fc.constant({ kind: 'null' } as RoleForm) },
  { weight: 2, arbitrary: fc.constant({ kind: 'absent' } as RoleForm) },
);

/** One generated Squad_Member, before parsing. */
interface MemberCase {
  readonly membershipId: string;
  readonly name: NameCase;
  readonly role: RoleForm;
  readonly state: MembershipStateValue;
  readonly isGuest: boolean;
}

const memberCaseArb: fc.Arbitrary<MemberCase> = fc.record({
  membershipId: fc.uuid(),
  name: nameCaseArb,
  role: roleFormArb,
  // Inactive rows are generated deliberately: the affordance does not depend on
  // the Membership_State, so an inactive guest must still offer it.
  state: fc.constantFrom<MembershipStateValue>('active', 'inactive'),
  isGuest: fc.boolean(),
});

interface SquadCase {
  readonly members: readonly MemberCase[];
  readonly viewerIsAdmin: boolean;
  /** Which of the editable rows to activate, taken modulo how many there are. */
  readonly activationSeed: number;
}

const squadCaseArb: fc.Arbitrary<SquadCase> = fc.record({
  members: fc.uniqueArray(memberCaseArb, {
    selector: (member) => member.membershipId,
    minLength: 1,
    maxLength: 6,
  }),
  viewerIsAdmin: fc.oneof(
    { weight: 4, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
  activationSeed: fc.nat({ max: 1_000 }),
});

// --- From a generated case to composed rows -----------------------------------

/** The `members` element a generated case describes, with an absent role unwritten. */
function memberBodyOf(member: MemberCase): Record<string, unknown> {
  const body: Record<string, unknown> = {
    membershipId: member.membershipId,
    displayName: member.name.value,
    state: codeFromMembershipState(member.state),
    isGuest: member.isGuest,
  };

  if (member.role.kind === 'present') {
    body.role = codeFromMemberRole(member.role.value);
  } else if (member.role.kind === 'null') {
    body.role = null;
  }

  return body;
}

/**
 * The composed Player_List a generated case describes.
 *
 * Parsing is asserted rather than assumed, so a generator that wandered outside
 * the accepted wire shape reports itself instead of narrowing the property; and
 * each row's derived `isFormerPlayer` is checked against the generator's own
 * verdict, so the affordance claims below cannot pass vacuously.
 */
function composedRowsOf(testCase: SquadCase): readonly PlayerListRow[] {
  const body = {
    squadId: SQUAD_ID,
    name: 'Thursday Ballers',
    members: testCase.members.map(memberBodyOf),
    features: [],
  };
  const detail = parseSquadDetail(body);

  if (!detail.ok) {
    throw new Error(
      `the generated detail must parse, but it did not: ${JSON.stringify(body)} — ${detail.reason}`,
    );
  }

  // No leaderboard: the Rating_Presentation is not this property's subject, and
  // Rating_Unavailable rows still carry every membership fact and control.
  const rows = composePlayerList(detail.value, null);

  expect(rows).toHaveLength(testCase.members.length);

  for (const member of testCase.members) {
    const row = rows.find(
      (candidate) => candidate.membershipId === member.membershipId,
    );

    expect(row).toBeDefined();
    expect((row as PlayerListRow).isGuest).toBe(member.isGuest);
    // 7.9: the composition's own recognition of the placeholder, against the
    // verdict the generator carried.
    expect((row as PlayerListRow).isFormerPlayer).toBe(member.name.isPlaceholder);
  }

  return rows;
}

/**
 * The membership identities whose rows must offer the edit affordance
 * (Requirement 12.7): Admin_Authority held, the Guest_Flag set, and the name not
 * the Anonymised_Placeholder. Stated from the requirement's words, not by calling
 * the predicate the components read.
 */
function expectedEditableIds(testCase: SquadCase): readonly string[] {
  if (!testCase.viewerIsAdmin) {
    return [];
  }

  return testCase.members
    .filter((member) => member.isGuest && !member.name.isPlaceholder)
    .map((member) => member.membershipId);
}

// --- The harness --------------------------------------------------------------

interface ApiDouble {
  readonly api: SquadsApi;
  readonly createGuest: ReturnType<typeof vi.fn>;
  readonly editGuest: ReturnType<typeof vi.fn>;
}

/** An api whose two guest calls never settle — no submission happens here anyway. */
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

interface HarnessProps {
  readonly rows: readonly PlayerListRow[];
  readonly viewer: ViewerContext;
  readonly api: SquadsApi;
  /** A target supplied before any row was activated, as a caller may do. */
  readonly initialTarget?: string | null;
}

/**
 * The Squad_Screen's wiring: the Player_List holds the affordance, the screen holds
 * the target it produces, and the Guest_Manager renders the form for it.
 */
function Harness({
  rows,
  viewer,
  api,
  initialTarget = null,
}: HarnessProps): ReactElement {
  const [editing, setEditing] = useState<string | null>(initialTarget);
  const finish = useCallback(() => setEditing(null), []);

  return (
    <div>
      <PlayerList
        squadId={SQUAD_ID}
        rows={rows}
        viewer={viewer}
        onOpenPlayer={() => {}}
        onPromote={() => {}}
        onEditGuest={setEditing}
      />
      <GuestManager
        squadId={SQUAD_ID}
        api={api}
        rows={rows}
        editingMembershipId={editing}
        onEditingFinished={finish}
        onSquadChanged={() => {}}
      />
    </div>
  );
}

/** The rendered rows, keyed by the membership identity each one carries. */
function renderedRows(container: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();

  for (const row of container.querySelectorAll<HTMLElement>(PLAYER_ROW_SELECTOR)) {
    const id = row.getAttribute(PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE) ?? '';

    expect(rows.has(id)).toBe(false);
    rows.set(id, row);
  }

  return rows;
}

/** The edit affordances a row carries. */
function editControlsOf(row: HTMLElement): readonly HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(PLAYER_ROW_EDIT_GUEST_SELECTOR)];
}

/** Whitespace collapsed the way an accessible name computation collapses it. */
function normalised(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** The open edit form, or `null`. */
function editForm(): HTMLElement | null {
  return screen.queryByRole('group', { name: EDIT_GUEST_HEADING });
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 12.7: the affordance appears on exactly the editable guest rows.
 *
 * Compared as a whole set rather than row by row, so a control missing from an
 * editable row, a duplicate on one, and a control on a registered membership or a
 * Former_Player all fail. Each control also names its own player, so an affordance
 * cannot be attributed to the wrong row.
 */
function expectAffordanceSetIsExact(
  container: HTMLElement,
  testCase: SquadCase,
  rows: readonly PlayerListRow[],
): void {
  const rendered = renderedRows(container);
  const expected = [...expectedEditableIds(testCase)].sort();
  const offered: string[] = [];

  expect([...rendered.keys()].sort()).toEqual(
    rows.map((row) => row.membershipId).sort(),
  );

  for (const row of rows) {
    const element = rendered.get(row.membershipId) as HTMLElement;
    const controls = editControlsOf(element);

    expect(controls.length).toBeLessThanOrEqual(1);

    if (controls.length === 1) {
      offered.push(row.membershipId);
      // The control states the act and whose row it is, so the affordance and the
      // guest it edits cannot be read apart.
      expect(controls[0]).toHaveAccessibleName(
        normalised(`${EDIT_GUEST_LABEL}: ${row.displayName}`),
      );
    }
  }

  expect(offered.sort()).toEqual(expected);
}

/**
 * Requirement 12.8: the opened form is *that* guest's — prefilled with the name as
 * parsed, offering the leave-unchanged option and having it selected, and rendering
 * no Lawful_Basis_Acknowledgement control.
 */
function expectEditFormFor(container: HTMLElement, row: PlayerListRow): void {
  const form = editForm();

  expect(form).not.toBeNull();

  // 12.8: prefilled with the name the list is showing, never reformatted.
  const field = screen.getByLabelText(GUEST_DISPLAY_NAME_LABEL) as HTMLInputElement;
  expect(field.value).toBe(row.displayName);

  const selects = container.querySelectorAll<HTMLSelectElement>(
    GUEST_FORM_TIER_SELECTOR,
  );
  expect(selects).toHaveLength(1);

  const select = selects[0];
  const labels = [...select.options].map((option) => option.textContent);

  // 12.8, 12.9: the edit sentinel is offered and selected; the create sentinel,
  // which would read as clearing the tier, is not offered at all.
  expect(select.value).toBe(LEAVE_UNCHANGED_VALUE);
  expect(select.options[select.selectedIndex]?.textContent).toBe(
    SKILL_TIER_LEAVE_UNCHANGED_LABEL,
  );
  expect(labels).toContain(SKILL_TIER_LEAVE_UNCHANGED_LABEL);
  expect(labels).not.toContain(SKILL_TIER_DO_NOT_SEED_LABEL);

  // 12.8: absent altogether, not merely unselected.
  expect(
    container.querySelectorAll(GUEST_FORM_ACKNOWLEDGEMENT_SELECTOR),
  ).toHaveLength(0);
}

// --- The property -------------------------------------------------------------

describe('Property 31 — the guest edit affordance appears exactly on editable guest rows', () => {
  // Feature: web-squads-screens, Property 31: The guest edit affordance appears exactly on editable guest rows
  // Validates: Requirements 12.7, 12.8
  it('renders the edit control on exactly the guest rows that are not the anonymised placeholder, and opens that guest\u2019s form', () => {
    fc.assert(
      fc.property(squadCaseArb, (testCase) => {
        const { api, editGuest } = apiDouble();
        const rows = composedRowsOf(testCase);
        const viewer: ViewerContext = {
          membershipId: VIEWER_MEMBERSHIP_ID,
          isAdmin: testCase.viewerIsAdmin,
        };
        const { container } = render(
          <Harness rows={rows} viewer={viewer} api={api} />,
        );

        try {
          expectAffordanceSetIsExact(container, testCase, rows);

          // Nothing is open until a row is activated.
          expect(editForm()).toBeNull();

          const editable = expectedEditableIds(testCase);

          if (editable.length === 0) {
            // The other direction: with no editable row there is no affordance at
            // all, so no form can be reached from the list.
            expect(
              container.querySelectorAll(PLAYER_ROW_EDIT_GUEST_SELECTOR),
            ).toHaveLength(0);
            return;
          }

          const targetId = editable[testCase.activationSeed % editable.length];
          const target = rows.find(
            (row) => row.membershipId === targetId,
          ) as PlayerListRow;
          const control = editControlsOf(
            renderedRows(container).get(targetId) as HTMLElement,
          )[0];

          fireEvent.click(control);

          expectEditFormFor(container, target);
          // Opening a form issues nothing: the call is a submission's consequence.
          expect(editGuest).not.toHaveBeenCalled();
        } finally {
          cleanup();
        }
      }),
      { numRuns: 150 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 31: The guest edit affordance appears exactly on editable guest rows
  // Validates: Requirements 12.7
  it('opens no edit form for a target the predicate rejects, however the caller supplies it', () => {
    fc.assert(
      fc.property(
        squadCaseArb,
        fc.constantFrom<'non-guest' | 'placeholder-guest' | 'absent'>(
          'non-guest',
          'placeholder-guest',
          'absent',
        ),
        (generated, targetKind) => {
          // Every kind of non-editable target is guaranteed present, plus an
          // editable guest — so "no form opened" cannot pass because the harness
          // could never have opened one.
          const testCase: SquadCase = {
            ...generated,
            viewerIsAdmin: true,
            members: [
              ...generated.members,
              {
                membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f11',
                name: { value: 'Registered Ruth', isPlaceholder: false },
                role: { kind: 'present', value: 'member' },
                state: 'active',
                isGuest: false,
              },
              {
                membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f12',
                name: { value: 'Former player', isPlaceholder: true },
                role: { kind: 'null' },
                state: 'inactive',
                isGuest: true,
              },
              {
                membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f13',
                name: { value: 'Big Dave', isPlaceholder: false },
                role: { kind: 'absent' },
                state: 'active',
                isGuest: true,
              },
            ].filter(
              (member, index, all) =>
                all.findIndex(
                  (other) => other.membershipId === member.membershipId,
                ) === index,
            ),
          };

          const targetId =
            targetKind === 'non-guest'
              ? '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f11'
              : targetKind === 'placeholder-guest'
                ? '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f12'
                : UNKNOWN_MEMBERSHIP_ID;

          const { api, editGuest } = apiDouble();
          const rows = composedRowsOf(testCase);
          const { container } = render(
            <Harness
              rows={rows}
              viewer={{ membershipId: VIEWER_MEMBERSHIP_ID, isAdmin: true }}
              api={api}
              initialTarget={targetId}
            />,
          );

          try {
            // 12.7: the predicate is applied a second time to the target, so an
            // identity a row would never have offered opens nothing.
            expect(editForm()).toBeNull();
            expect(
              screen.queryByLabelText(GUEST_DISPLAY_NAME_LABEL),
            ).not.toBeInTheDocument();
            expect(editGuest).not.toHaveBeenCalled();

            // And the affordance set is still exactly right, so the rejected
            // target changed nothing about the list beside it.
            expectAffordanceSetIsExact(container, testCase, rows);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 180_000);
});
