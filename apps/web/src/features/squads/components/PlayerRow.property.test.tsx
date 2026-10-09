/**
 * Property test for the Player_Row's membership facts (task 11.4).
 *
 * **Property 16: Every Player_Row states its membership facts in text.** *For any*
 * Squad_Member, the Player_Row renders the display name, a text label naming the
 * role, a text label naming the membership state, a text label naming the
 * membership as a guest exactly when the guest flag is set, no label naming owner,
 * admin, or member when the role is absent and the guest flag is set, a text label
 * naming the membership as inactive together with a non-colour visual cue exactly
 * when the state is inactive, and a text label naming the entry as a former player
 * exactly when the display name is the anonymised placeholder; and a former-player
 * row renders neither a promotion control nor a guest edit action while retaining
 * its navigation control.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 7.5 — the name, a role label, a state label, and a guest label where the flag is set | {@link expectNameIsStatedVerbatim}, {@link expectLabelsAreExactly} |
 * | 7.6 — an absent role on a guest states `Guest` and names no owner, admin, or member | {@link expectLabelsAreExactly}, {@link expectNoRoleIsNamed} |
 * | 7.7 — an inactive row carries the word *and* a non-colour cue, and stays navigable | {@link expectInactiveCue} |
 * | 7.8 — the Former_Player label exactly on the placeholder, and no admin action there | {@link expectLabelsAreExactly}, {@link expectFormerPlayerOffersNoAdminAction} |
 * | 9.8 — the navigation control survives on a Former_Player row | {@link expectFormerPlayerOffersNoAdminAction} |
 * | 19.3 — every fact is carried by words, not by a hue | {@link expectFactsSurviveWithoutColour} |
 *
 * ### The row is composed, not hand-built
 *
 * Every case here is a **parsed** `SquadMember` inside a **parsed** `SquadDetail`,
 * put through `composePlayerList` and rendered as the single row that comes out.
 * Two things follow, both of which a hand-written `PlayerListRow` would quietly
 * assume away:
 *
 * 1. The role absence under test is the one the backend actually serialises.
 *    `GetSquad` projects a guest's role as `null` *or* omits the property, and the
 *    parser makes those the same absence (16.8) — so both forms are generated and a
 *    third property pins them as rendering byte-identical markup.
 * 2. `isFormerPlayer` is **derived** by the composition rather than asserted into
 *    place. Each generated name carries its own independent verdict on whether it
 *    is the placeholder, and that verdict is checked against the composed row, so a
 *    composition that stopped recognising `'Former player'` fails here rather than
 *    letting the label claim pass vacuously.
 *
 * ### Why the labels are compared as a whole set
 *
 * Requirement 7.5 asks for a fixed set of statements and Requirements 7.6 and 7.8
 * ask for two of them to be *absent* in particular cases. Asserting "the expected
 * label is present" would miss the failure that actually matters — an extra chip
 * beside it. So the rendered labels are read as `(kind, text)` pairs and compared
 * to the exact expected multiset: a missing guest label, a duplicated one, a role
 * chip rendered next to the absence statement, or a Former_Player label on a live
 * membership all fail. {@link expectNoRoleIsNamed} then adds the stronger reading
 * of 7.6 — that no *word* naming owner, admin, or member appears among the labels,
 * not merely no label that equals one.
 *
 * ### Why the viewer is generated as an admin most of the time
 *
 * The Former_Player clause of 7.8 is only meaningful where the admin controls could
 * otherwise have appeared, so the generated viewer holds Admin_Authority on most
 * runs and is sometimes the row's own membership. A non-admin viewer would satisfy
 * "no promotion control" for a reason that has nothing to do with anonymisation.
 *
 * Feature: web-squads-screens, Property 16: Every Player_Row states its membership facts in text
 * Validates: Requirements 7.5, 7.6, 7.7, 7.8, 9.8, 19.3
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import {
  INACTIVE_GLYPH_SELECTOR,
  MEMBERSHIP_LABEL_KIND_ATTRIBUTE,
  MEMBERSHIP_LABEL_SELECTOR,
} from './MembershipLabels';
import {
  PLAYER_ROW_EDIT_GUEST_SELECTOR,
  PLAYER_ROW_OPEN_SELECTOR,
  PLAYER_ROW_PROMOTE_SELECTOR,
  PLAYER_ROW_SELECTOR,
  PlayerRow,
  type ViewerContext,
} from './PlayerRow';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import {
  ACTIVE_STATE_LABEL,
  ADMIN_ROLE_LABEL,
  FORMER_PLAYER_LABEL,
  GUEST_LABEL,
  INACTIVE_STATE_LABEL,
  MEMBER_ROLE_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
} from '../lib/messages';
import {
  parseDisplayRatingLeaderboard,
  type DisplayRatingLeaderboard,
} from '../lib/parse/leaderboard';
import { parseSquadDetail } from '../lib/parse/squadDetail';
import { composePlayerList, type PlayerListRow } from '../lib/playerList';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
const VIEWER_MEMBERSHIP_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// --- The labels under test ----------------------------------------------------

/** The label a named Member_Role must render as (Requirement 7.5). */
const LABEL_OF_ROLE: Readonly<Record<SquadRole, string>> = {
  Owner: OWNER_ROLE_LABEL,
  Admin: ADMIN_ROLE_LABEL,
  Member: MEMBER_ROLE_LABEL,
};

/** The label a named Membership_State must render as (Requirement 7.5). */
const LABEL_OF_STATE: Readonly<Record<MembershipState, string>> = {
  Active: ACTIVE_STATE_LABEL,
  Inactive: INACTIVE_STATE_LABEL,
};

/** The three labels a guest's row may not carry (Requirement 7.6). */
const ROLE_NAMING_LABELS: readonly string[] = [
  OWNER_ROLE_LABEL,
  ADMIN_ROLE_LABEL,
  MEMBER_ROLE_LABEL,
];

/** One rendered membership label: the fact it states and the words it states it in. */
interface RenderedLabel {
  readonly kind: string;
  readonly text: string;
}

/** A stable ordering, so two label sets compare as multisets rather than sequences. */
function sortedLabels(labels: readonly RenderedLabel[]): readonly RenderedLabel[] {
  return [...labels].sort((left, right) =>
    `${left.kind}\u0000${left.text}`.localeCompare(
      `${right.kind}\u0000${right.text}`,
    ),
  );
}

// --- Generators ---------------------------------------------------------------

/**
 * How the wire body carries the role: as a code, as `null`, or not at all. The
 * last two are the same parsed absence and only one of them is the shape the
 * backend serialises, so both are generated (Requirement 16.8).
 */
type RoleForm =
  | { readonly kind: 'present'; readonly value: SquadRole }
  | { readonly kind: 'null' }
  | { readonly kind: 'absent' };

const roleFormArb: fc.Arbitrary<RoleForm> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .constantFrom<SquadRole>('Owner', 'Admin', 'Member')
      .map((value) => ({ kind: 'present', value }) as RoleForm),
  },
  { weight: 2, arbitrary: fc.constant({ kind: 'null' } as RoleForm) },
  { weight: 2, arbitrary: fc.constant({ kind: 'absent' } as RoleForm) },
);

/**
 * A Player_Display_Name together with an **independent** verdict on whether it is
 * the Anonymised_Placeholder — independent because it is carried by the generator
 * rather than recomputed from the predicate under test.
 *
 * The pool is built around the placeholder's edges: the bare placeholder, the
 * placeholder inside whitespace (still the placeholder, since recognition trims),
 * and the near misses that are *not* it — a case variant, an interior-whitespace
 * variant, a plural, and a run-together form. A row wrongly read as anonymised
 * loses a real player's promotion control and is labelled as erased, so both
 * directions of the recognition matter here.
 */
interface NameCase {
  readonly value: string;
  readonly isPlaceholder: boolean;
}

const PLACEHOLDER_NAMES: readonly string[] = [
  'Former player',
  ' Former player',
  'Former player ',
  '  Former player  ',
  '\tFormer player\n',
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
      .constantFrom('Dave', 'BigDave', "Síobhán O'Neill", 'Ali', '日本語の名前')
      .map((value) => ({ value, isPlaceholder: false })),
  },
  {
    weight: 2,
    // Letters, numbers, punctuation, and single interior spaces only, so the
    // rendered name and the computed accessible name collapse identically —
    // exotic whitespace would make that comparison a coin toss rather than a
    // claim about the row.
    arbitrary: fc
      .string({ minLength: 1, maxLength: 40, unit: 'grapheme' })
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

/** A well-formed membership identity, in either letter case. */
const membershipIdArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((value) => value.toUpperCase()) },
);

/**
 * What rating data was available: none at all, an entry for this membership, or a
 * leaderboard carrying somebody else's entry. The Rating_Presentation is not this
 * property's subject — it is varied so that a membership label cannot depend on it.
 */
type RatingForm = 'no-leaderboard' | 'own-entry' | 'other-entry';

const ratingFormArb: fc.Arbitrary<RatingForm> = fc.constantFrom<RatingForm>(
  'no-leaderboard',
  'own-entry',
  'other-entry',
);

interface RowCase {
  readonly membershipId: string;
  readonly name: NameCase;
  readonly role: RoleForm;
  readonly state: MembershipState;
  readonly isGuest: boolean;
  readonly rating: RatingForm;
  readonly viewerIsAdmin: boolean;
  readonly viewerIsSelf: boolean;
}

const rowCaseArb: fc.Arbitrary<RowCase> = fc.record({
  membershipId: membershipIdArb,
  name: nameCaseArb,
  role: roleFormArb,
  state: fc.constantFrom<MembershipState>('Active', 'Inactive'),
  isGuest: fc.boolean(),
  rating: ratingFormArb,
  // Weighted towards Admin_Authority so the "no admin action on a Former_Player"
  // clause is exercised where the controls could otherwise have appeared.
  viewerIsAdmin: fc.oneof(
    { weight: 4, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
  viewerIsSelf: fc.oneof(
    { weight: 1, arbitrary: fc.constant(true) },
    { weight: 4, arbitrary: fc.constant(false) },
  ),
});

// --- From a generated case to a composed row ----------------------------------

/** The `members` element a generated case describes, with an absent role unwritten. */
function memberBodyOf(testCase: RowCase): Record<string, unknown> {
  const body: Record<string, unknown> = {
    membershipId: testCase.membershipId,
    displayName: testCase.name.value,
    state: testCase.state,
    isGuest: testCase.isGuest,
    appearances: 12,
    ratingState: 'Established',
  };

  if (testCase.role.kind === 'present') {
    body.role = testCase.role.value;
  } else if (testCase.role.kind === 'null') {
    body.role = null;
  }

  return body;
}

/** The parsed leaderboard a case describes, or `null` when none was obtained. */
function parsedLeaderboardOf(testCase: RowCase): DisplayRatingLeaderboard | null {
  if (testCase.rating === 'no-leaderboard') {
    return null;
  }

  const membershipId =
    testCase.rating === 'own-entry'
      ? testCase.membershipId
      : '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f99';
  const body = {
    entries: [{ membershipId, displayName: 'Somebody', value: 1240.5 }],
  };
  const parsed = parseDisplayRatingLeaderboard(body);

  if (!parsed.ok) {
    throw new Error(`the generated leaderboard must parse — ${parsed.reason}`);
  }

  return parsed.value;
}

/**
 * The single composed Player_List row a generated case describes.
 *
 * Parsing is asserted rather than assumed, so a generator that wandered outside
 * the accepted wire shape reports itself instead of narrowing the property; and
 * the row's derived `isFormerPlayer` is checked against the generator's own
 * verdict, so the label claims below cannot pass vacuously.
 */
function composedRowOf(testCase: RowCase): PlayerListRow {
  const body = {
    squadId: SQUAD_ID,
    name: 'Thursday Ballers',
    members: [memberBodyOf(testCase)],
    features: [],
  };
  const detail = parseSquadDetail(body);

  if (!detail.ok) {
    throw new Error(
      `the generated detail must parse, but it did not: ${JSON.stringify(body)} — ${detail.reason}`,
    );
  }

  const rows = composePlayerList(detail.value, parsedLeaderboardOf(testCase));

  expect(rows).toHaveLength(1);
  // The composition's own recognition of the placeholder, checked against the
  // verdict the generator carried (Requirements 7.8, 7.9).
  expect(rows[0].isFormerPlayer).toBe(testCase.name.isPlaceholder);

  return rows[0];
}

/** The viewer a generated case describes. */
function viewerOf(testCase: RowCase): ViewerContext {
  return {
    membershipId: testCase.viewerIsSelf
      ? testCase.membershipId
      : VIEWER_MEMBERSHIP_ID,
    isAdmin: testCase.viewerIsAdmin,
  };
}

/** The labels a case must render, and no others (Requirements 7.5, 7.6, 7.8). */
function expectedLabelsOf(testCase: RowCase): readonly RenderedLabel[] {
  const labels: RenderedLabel[] = [];

  if (testCase.role.kind === 'present') {
    labels.push({ kind: 'role', text: LABEL_OF_ROLE[testCase.role.value] });
  } else if (testCase.isGuest) {
    // 7.6: the guest label takes the role slot, so no role is named at all.
    labels.push({ kind: 'guest', text: GUEST_LABEL });
  } else {
    labels.push({ kind: 'role', text: NO_ROLE_RECORDED_LABEL });
  }

  labels.push({ kind: 'state', text: LABEL_OF_STATE[testCase.state] });

  // 7.5: the Guest_Flag is stated exactly once, however the two fields arrive.
  if (testCase.isGuest && testCase.role.kind === 'present') {
    labels.push({ kind: 'guest', text: GUEST_LABEL });
  }

  if (testCase.name.isPlaceholder) {
    labels.push({ kind: 'former-player', text: FORMER_PLAYER_LABEL });
  }

  return labels;
}

// --- Rendering ----------------------------------------------------------------

interface Rendered {
  readonly row: HTMLElement;
  readonly onPromote: ReturnType<typeof vi.fn>;
  readonly onEditGuest: ReturnType<typeof vi.fn>;
}

/** Render one generated case and hand back its single row element. */
function renderCase(testCase: RowCase): Rendered {
  const onPromote = vi.fn();
  const onEditGuest = vi.fn();
  const { container } = render(
    <PlayerRow
      squadId={SQUAD_ID}
      row={composedRowOf(testCase)}
      viewer={viewerOf(testCase)}
      onOpenPlayer={vi.fn()}
      onPromote={onPromote}
      onEditGuest={onEditGuest}
    />,
  );

  const rows = container.querySelectorAll<HTMLElement>(PLAYER_ROW_SELECTOR);

  expect(rows).toHaveLength(1);

  return { row: rows[0], onPromote, onEditGuest };
}

/**
 * React's `useId` tokens, in the shapes React has emitted (`_r_1a_` today, `:r1:`
 * and `«r1»` in earlier majors).
 */
const REACT_GENERATED_ID = /_r_[0-9a-z]+_|:r[0-9a-z]+:|«r[0-9a-z]+»/g;

/**
 * The row's markup with React's generated identifiers neutralised.
 *
 * The row names itself by its player with `aria-labelledby`, so the name element
 * carries a `useId` value — a fresh, counter-driven token on every render. Two
 * renders of the *same* row therefore never produce byte-identical markup, which
 * would make the null-versus-absent comparison fail for a reason that has nothing
 * to do with the role. Only the generated token is replaced, not the attributes
 * that hold it: every other byte — including a hand-written `id`, the association
 * itself, and any label, class, or data attribute — is still compared exactly, so
 * a row that genuinely rendered a `null` role differently still fails.
 */
function withoutGeneratedIds(markup: string): string {
  return markup.replace(REACT_GENERATED_ID, '«generated-id»');
}

/** The `(kind, text)` pairs a row states. */
function labelsOf(row: HTMLElement): readonly RenderedLabel[] {
  return [...row.querySelectorAll<HTMLElement>(MEMBERSHIP_LABEL_SELECTOR)].map(
    (label) => ({
      kind: label.getAttribute(MEMBERSHIP_LABEL_KIND_ATTRIBUTE) ?? '',
      text: label.textContent ?? '',
    }),
  );
}

/** The row's single navigation control (Requirements 9.1, 9.8). */
function openControlOf(row: HTMLElement): HTMLElement {
  const controls = row.querySelectorAll<HTMLElement>(PLAYER_ROW_OPEN_SELECTOR);

  expect(controls).toHaveLength(1);

  return controls[0];
}

/** Whitespace collapsed the way an accessible name computation collapses it. */
function normalised(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 7.5: the Player_Display_Name is rendered exactly as parsed — the
 * navigation control's only content — and is that control's accessible name, so
 * the displayed name and the announced name cannot drift (Requirement 9.5).
 */
function expectNameIsStatedVerbatim(row: HTMLElement, displayName: string): void {
  const open = openControlOf(row);

  expect(open.textContent).toBe(displayName);
  expect(open).toHaveAccessibleName(normalised(displayName));
}

/**
 * Requirements 7.5, 7.6, 7.8: the row states exactly the expected facts — no
 * missing label, no duplicate, and no extra chip beside an absence statement.
 */
function expectLabelsAreExactly(
  row: HTMLElement,
  expected: readonly RenderedLabel[],
): void {
  expect(sortedLabels(labelsOf(row))).toEqual(sortedLabels(expected));
}

/**
 * Requirement 7.6: where the role is absent and the Guest_Flag is set, no label
 * *names* owner, admin, or member — not as its whole text, and not within it.
 */
function expectNoRoleIsNamed(row: HTMLElement): void {
  const labels = labelsOf(row);
  const stated = labels.map((label) => label.text).join(' \u0000 ');

  for (const label of ROLE_NAMING_LABELS) {
    expect(labels.some((rendered) => rendered.text === label)).toBe(false);
    expect(stated).not.toContain(label);
  }
}

/**
 * Requirement 7.7: an inactive membership is told apart by the word **and** by a
 * non-colour cue, and keeps its navigation to the Player_Stats_Route; an active
 * one carries no such cue. The glyph is hidden from assistive technology because
 * the word beside it already carries the fact.
 */
function expectInactiveCue(row: HTMLElement, state: MembershipState): void {
  const glyphs = row.querySelectorAll<HTMLElement>(INACTIVE_GLYPH_SELECTOR);

  if (state === 'Inactive') {
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].getAttribute('aria-hidden')).toBe('true');
    expect(glyphs[0].textContent?.trim()).not.toBe('');
    // The state is on the row itself as well, so the muted surface cannot be
    // painted on a row whose label says otherwise.
    expect(row.getAttribute('data-membership-state')).toBe('Inactive');
    // 7.7: still reachable, so a de-activated membership's stats stay open.
    expect(openControlOf(row)).toBeInTheDocument();
  } else {
    expect(glyphs).toHaveLength(0);
    expect(row.getAttribute('data-membership-state')).toBe('Active');
  }
}

/**
 * Requirements 7.8, 9.8: a Former_Player row offers no promotion and no guest
 * edit action even to an admin, and keeps exactly one navigation control so its
 * retained stats stay reachable.
 */
function expectFormerPlayerOffersNoAdminAction(rendered: Rendered): void {
  expect(rendered.row.querySelectorAll(PLAYER_ROW_PROMOTE_SELECTOR)).toHaveLength(0);
  expect(rendered.row.querySelectorAll(PLAYER_ROW_EDIT_GUEST_SELECTOR)).toHaveLength(
    0,
  );
  expect(openControlOf(rendered.row)).toBeInTheDocument();
  // Nothing was handed on either: no admin callback can fire from a row that
  // renders no admin control.
  expect(rendered.onPromote).not.toHaveBeenCalled();
  expect(rendered.onEditGuest).not.toHaveBeenCalled();
}

/**
 * Requirement 19.3: every fact survives with all colour discarded. Each label's
 * whole text is the statement, none is hidden from assistive technology, and no
 * element in the row carries an inline colour — every value comes from the token
 * table, so removing the stylesheet removes emphasis and leaves the words.
 */
function expectFactsSurviveWithoutColour(
  row: HTMLElement,
  expected: readonly RenderedLabel[],
): void {
  const labels = [...row.querySelectorAll<HTMLElement>(MEMBERSHIP_LABEL_SELECTOR)];

  expect(labels).toHaveLength(expected.length);

  for (const label of labels) {
    expect(label.textContent?.trim()).not.toBe('');
    expect(label.closest('[aria-hidden="true"]')).toBeNull();
  }

  for (const element of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
    expect(element.hasAttribute('style')).toBe(false);
    expect(element.hasAttribute('color')).toBe(false);
  }
}

// --- The property -------------------------------------------------------------

describe('Property 16 — every Player_Row states its membership facts in text', () => {
  // Feature: web-squads-screens, Property 16: Every Player_Row states its membership facts in text
  // Validates: Requirements 7.5, 7.6, 7.7, 7.8, 9.8, 19.3
  it('states the name, the role or guest label, the state, and the former-player label, and no others', () => {
    fc.assert(
      fc.property(rowCaseArb, (testCase) => {
        const rendered = renderCase(testCase);

        try {
          const expected = expectedLabelsOf(testCase);

          expectNameIsStatedVerbatim(rendered.row, testCase.name.value);
          expectLabelsAreExactly(rendered.row, expected);
          expectInactiveCue(rendered.row, testCase.state);
          expectFactsSurviveWithoutColour(rendered.row, expected);

          if (testCase.role.kind !== 'present' && testCase.isGuest) {
            expectNoRoleIsNamed(rendered.row);
          }

          if (testCase.name.isPlaceholder) {
            expectFormerPlayerOffersNoAdminAction(rendered);
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 16: Every Player_Row states its membership facts in text
  // Validates: Requirements 7.6
  it('renders a null role and an absent role identically', () => {
    fc.assert(
      fc.property(
        membershipIdArb,
        nameCaseArb,
        fc.constantFrom<MembershipState>('Active', 'Inactive'),
        fc.boolean(),
        fc.boolean(),
        (membershipId, name, state, isGuest, viewerIsAdmin) => {
          const markupFor = (role: RoleForm): string => {
            const rendered = renderCase({
              membershipId,
              name,
              role,
              state,
              isGuest,
              rating: 'own-entry',
              viewerIsAdmin,
              viewerIsSelf: false,
            });

            try {
              return withoutGeneratedIds(rendered.row.innerHTML);
            } finally {
              cleanup();
            }
          };

          // The parser makes `null` and a missing property one absence, so the
          // row cannot tell them apart (Requirement 16.8).
          expect(markupFor({ kind: 'null' })).toBe(markupFor({ kind: 'absent' }));
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 16: Every Player_Row states its membership facts in text
  // Validates: Requirements 7.5, 7.6
  it('states the guest flag exactly once, whether or not the membership also carried a role', () => {
    fc.assert(
      fc.property(rowCaseArb, (testCase) => {
        const guestCase = { ...testCase, isGuest: true };
        const rendered = renderCase(guestCase);

        try {
          const guestLabels = labelsOf(rendered.row).filter(
            (label) => label.kind === 'guest',
          );

          expect(guestLabels).toEqual([{ kind: 'guest', text: GUEST_LABEL }]);

          // And a membership without the flag states it nowhere.
          cleanup();

          const registered = renderCase({ ...guestCase, isGuest: false });

          expect(
            labelsOf(registered.row).filter((label) => label.kind === 'guest'),
          ).toEqual([]);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 150 },
    );
  }, 120_000);
});
