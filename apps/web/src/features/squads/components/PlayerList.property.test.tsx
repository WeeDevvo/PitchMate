/**
 * Property test for the rendered Player_Order (task 11.6).
 *
 * **Property 15: The Player_Order is a total order determined solely by its
 * input.** *For any* composed Player_List input, the rendered Player_Row order
 * places every active membership before every inactive membership, then orders by
 * display name ascending under a case-insensitive comparison, then by membership
 * identity ascending; and *for any* two permutations of the same input the
 * rendered order is identical.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | active before inactive | {@link expectActiveRowsRenderFirst}, read from the rendered rows alone |
 * | then display name ascending, case-insensitively | {@link expectRenderedOrderIsThePlayerOrder} |
 * | then membership identity ascending | {@link expectEqualNamesBreakByIdentity} |
 * | a *total* order — every pair ordered, none equal | {@link expectEveryPairIsOrdered} |
 * | determined solely by its input (20.6) | the permutation property below |
 *
 * ### Why this sits beside the component when a comparator test already exists
 *
 * `lib/playerList.property.test.ts` claims the comparator's algebra. This file
 * claims the only thing a person can actually see: the sequence of rows in the
 * document. The two are genuinely different statements, because
 * `composePlayerList` returns rows already ordered — so a `PlayerList` that
 * rendered its `rows` prop in the order it arrived would pass every comparator
 * test and still hand a caller the power to rearrange somebody's squad by handing
 * the rows over shuffled. The input here is therefore a **permutation** of the
 * composed list on every run, and the rendered order must not move.
 *
 * ### The rows are composed, not hand-built
 *
 * Each case starts as a generated `GetSquad` wire body put through
 * `parseSquadDetail`, optionally decorated by a parsed `GetSquadLeaderboard`, and
 * composed by `composePlayerList` — then shuffled before it reaches the
 * component. So the rows carry the shapes the backend actually sends (a guest's
 * role arrives as `null` *or* as a missing property, 16.8) rather than shapes a
 * test invented, and `isFormerPlayer` is derived rather than asserted into place.
 *
 * The rating data and the viewer's Admin_Authority are generated too, and neither
 * is an ordering key: a row's rating decides its badge and the viewer decides its
 * admin controls, so a rendering that sorted by either — or that let a failed
 * leaderboard call rearrange the list — fails here.
 *
 * ### The rule is restated rather than imported
 *
 * {@link compareByRule} spells Requirement 7.4 out through `Intl.Collator` and a
 * code-unit identity comparison, a different route to the same collation than
 * `comparePlayerRows` takes. The rendered sequence is checked against that
 * restatement *and* against `comparePlayerRows`, the second being the claim that
 * the component holds no ordering of its own.
 *
 * Deliberately **not** claimed here: what a row *says* (Property 16), its
 * navigation seam (Property 24), the rating presentations (Properties 21 and 22),
 * or the composition's membership (Property 14).
 *
 * Feature: web-squads-screens, Property 15: The Player_Order is a total order determined solely by its input
 * Validates: Requirements 7.4, 20.6
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import {
  PLAYER_LIST_EMPTY_SELECTOR,
  PLAYER_LIST_SELECTOR,
  PlayerList,
} from './PlayerList';
import {
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_SELECTOR,
  type ViewerContext,
} from './PlayerRow';
import {
  codeFromMemberRole,
  codeFromMembershipState,
  type MembershipStateValue,
} from '../lib/enumCodes';
import { parseDisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import { parseSquadDetail } from '../lib/parse/squadDetail';
import {
  comparePlayerRows,
  composePlayerList,
  type PlayerListRow,
} from '../lib/playerList';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
const VIEWER_MEMBERSHIP_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** The attribute {@link PlayerRow} paints the Membership_State onto. */
const MEMBERSHIP_STATE_ATTRIBUTE = 'data-membership-state';

// --- The rule, restated ------------------------------------------------------

/**
 * The case-insensitive name comparison of Requirement 7.4, reached by a different
 * route than the module takes: an `Intl.Collator` at base sensitivity rather than
 * `String.prototype.localeCompare` with the same option. Same collation, so
 * agreement is evidence about the criterion instead of the implementation
 * restated.
 */
const baseCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Active memberships sort first (Requirement 7.4). */
const stateRank = (state: MembershipStateValue): 0 | 1 =>
  state === 'active' ? 0 : 1;

/**
 * Requirement 7.4 written out key by key: active before inactive, then display
 * name ascending case-insensitively, then membership identity ascending.
 *
 * @returns `-1`, `0`, or `1`; `0` only for two rows of the same membership
 */
function compareByRule(left: PlayerListRow, right: PlayerListRow): -1 | 0 | 1 {
  const leftRank = stateRank(left.state);
  const rightRank = stateRank(right.state);

  if (leftRank !== rightRank) {
    return leftRank < rightRank ? -1 : 1;
  }

  const byName = baseCollator.compare(left.displayName, right.displayName);

  if (byName !== 0) {
    return byName < 0 ? -1 : 1;
  }

  if (left.membershipId === right.membershipId) {
    return 0;
  }

  return left.membershipId < right.membershipId ? -1 : 1;
}

/** The membership identities in the order Requirement 7.4 demands. */
function expectedIdentityOrder(rows: readonly PlayerListRow[]): readonly string[] {
  return [...rows].sort(compareByRule).map((row) => row.membershipId);
}

// --- Generators --------------------------------------------------------------

/**
 * How a `members` element carries its Member_Role: as a code, as `null`, or not at
 * all. The codes come from the Enum_Code_Map, the only module in the feature —
 * tests included — allowed to write a numeric enum literal (Requirement 16.7).
 */
type RoleField = number | null | 'absent';

const roleFieldArb: fc.Arbitrary<RoleField> = fc.constantFrom(
  codeFromMemberRole('owner'),
  codeFromMemberRole('admin'),
  codeFromMemberRole('member'),
  null,
  'absent' as const,
);

const stateArb: fc.Arbitrary<MembershipStateValue> = fc.constantFrom(
  'active' as const,
  'inactive' as const,
);

/**
 * Display names built to collide: outright duplicates, castings of one name, and
 * accent variants — all of which compare **equal** under the ordering's
 * case-insensitive collation, so the identity tie-break decides them.
 *
 * A squad genuinely contains these. Names are unique within a squad as *names*,
 * and `Dave` and `dave` are two distinct names, so equal-collating rows are the
 * common input here rather than a corner case. `Former player` is in the pool
 * because an anonymised membership is an ordinary row for ordering purposes.
 */
const COLLIDING_NAMES: readonly string[] = [
  'dave',
  'Dave',
  'DAVE',
  'dAvE',
  'dàve',
  'Big Dave',
  'big dave',
  'sam',
  'Sam',
  'sám',
  'élan',
  'Élan',
  'ELAN',
  'Former player',
  'Zoe',
  'zoe',
  'Ash',
  'ash',
];

/**
 * A Player_Display_Name: mostly a colliding one, occasionally free text, so the
 * order is exercised over whatever the backend calls a player as well as over the
 * ties. The empty result of a whitespace-only draw is discarded, since a name that
 * short says nothing about the ordering the pool does not already say.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...COLLIDING_NAMES) },
  {
    weight: 1,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 16, unit: 'grapheme' })
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length > 0),
  },
);

/**
 * A well-formed membership identity, in either letter case. Both are generated
 * because the tie-break compares identities by code unit, where `A` sorts before
 * `a` — a comparison a case-folding tie-break would get wrong.
 */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/** One generated `members` element, before its identity is assigned. */
interface MemberCase {
  readonly displayName: string;
  readonly role: RoleField;
  readonly state: MembershipStateValue;
  readonly isGuest: boolean;
  /** Whether the leaderboard, if obtained, carries an entry for this membership. */
  readonly hasRating: boolean;
}

/** A generated membership together with the identity it was given. */
interface IdentifiedMemberCase extends MemberCase {
  readonly membershipId: string;
}

const memberCaseArb: fc.Arbitrary<MemberCase> = fc.record({
  displayName: nameArb,
  role: roleFieldArb,
  state: stateArb,
  isGuest: fc.boolean(),
  hasRating: fc.boolean(),
});

/**
 * Member counts the criteria name: none, one, and a handful. The 200-row case has
 * its own property below, where a fixed name pattern makes the identity tie-break
 * decide almost the whole sequence.
 */
const memberCountArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.constant(1) },
  { weight: 6, arbitrary: fc.integer({ min: 2, max: 14 }) },
);

/**
 * A membership collection with **distinct** identities — the form `GetSquad`
 * returns, and the precondition under which the Player_Order is a *strict* total
 * order.
 */
const collectionArb: fc.Arbitrary<readonly IdentifiedMemberCase[]> = memberCountArb
  .chain((count) =>
    fc.tuple(
      fc.array(memberCaseArb, { minLength: count, maxLength: count }),
      fc.uniqueArray(identityArb, { minLength: count, maxLength: count }),
    ),
  )
  .map(([cases, identities]) =>
    cases.map((memberCase, index) => ({
      ...memberCase,
      membershipId: identities[index],
    })),
  );

/**
 * A 200-membership squad whose display names repeat heavily: forty rows per name,
 * so the identity tie-break decides almost the entire rendered sequence, and every
 * third membership inactive so both state blocks are large.
 */
const largeCollectionArb: fc.Arbitrary<readonly IdentifiedMemberCase[]> = fc
  .uniqueArray(identityArb, { minLength: 200, maxLength: 200 })
  .map((identities) =>
    identities.map((membershipId, index) => ({
      membershipId,
      displayName: ['dave', 'Dave', 'DAVE', 'Former player', 'sám'][index % 5],
      role: (index % 4 === 0 ? null : codeFromMemberRole('member')) as RoleField,
      state: (index % 3 === 0 ? 'inactive' : 'active') as MembershipStateValue,
      isGuest: index % 4 === 0,
      hasRating: index % 2 === 0,
    })),
  );

/** Whether a leaderboard was obtained at all, and how the viewer is placed. */
interface ListCase {
  readonly members: readonly IdentifiedMemberCase[];
  readonly leaderboardObtained: boolean;
  readonly viewerIsAdmin: boolean;
  /** Whether the viewer is one of the rows, which changes which controls appear. */
  readonly viewerIsMember: boolean;
}

const listCaseArb = (
  members: fc.Arbitrary<readonly IdentifiedMemberCase[]>,
): fc.Arbitrary<ListCase> =>
  fc.record({
    members,
    // Both the obtained and the not-obtained leaderboard, because a failed
    // leaderboard call must not rearrange the list (Requirement 7.10).
    leaderboardObtained: fc.boolean(),
    viewerIsAdmin: fc.boolean(),
    viewerIsMember: fc.boolean(),
  });

/** A permutation of a row collection, of the same length. */
const permutationArb = (
  rows: readonly PlayerListRow[],
): fc.Arbitrary<readonly PlayerListRow[]> =>
  rows.length === 0
    ? fc.constant<readonly PlayerListRow[]>([])
    : fc.shuffledSubarray([...rows], {
        minLength: rows.length,
        maxLength: rows.length,
      });

// --- From a generated case to composed rows ----------------------------------

/** The `members` element a generated case describes, with an absent role unwritten. */
function memberBodyOf(memberCase: IdentifiedMemberCase): Record<string, unknown> {
  const body: Record<string, unknown> = {
    membershipId: memberCase.membershipId,
    displayName: memberCase.displayName,
    state: codeFromMembershipState(memberCase.state),
    isGuest: memberCase.isGuest,
  };

  if (memberCase.role !== 'absent') {
    body.role = memberCase.role;
  }

  return body;
}

/**
 * The rows a generated case composes to, in the Player_Order
 * `composePlayerList` returns them in.
 *
 * Parsing is asserted rather than assumed, so a generator that wandered outside
 * the accepted wire shape reports itself instead of silently narrowing the
 * property. The leaderboard's entries are reversed relative to the memberships so
 * that its ranking never matches the membership order — nothing about the rendered
 * sequence may follow from it.
 */
function composedRowsOf(listCase: ListCase): readonly PlayerListRow[] {
  const detailBody = {
    squadId: SQUAD_ID,
    name: 'Thursday Ballers',
    members: listCase.members.map(memberBodyOf),
    features: [],
  };
  const detail = parseSquadDetail(detailBody);

  if (!detail.ok) {
    throw new Error(
      `the generated detail must parse, but it did not: ${JSON.stringify(detailBody)} — ${detail.reason}`,
    );
  }

  if (!listCase.leaderboardObtained) {
    return composePlayerList(detail.value, null);
  }

  const leaderboardBody = {
    entries: [...listCase.members]
      .reverse()
      .filter((memberCase) => memberCase.hasRating)
      .map((memberCase, index) => ({
        membershipId: memberCase.membershipId,
        displayName: memberCase.displayName,
        value: 1000 + index,
      })),
  };
  const leaderboard = parseDisplayRatingLeaderboard(leaderboardBody);

  if (!leaderboard.ok) {
    throw new Error(
      `the generated leaderboard must parse, but it did not: ${JSON.stringify(leaderboardBody)} — ${leaderboard.reason}`,
    );
  }

  return composePlayerList(detail.value, leaderboard.value);
}

/** The viewer a generated case describes. */
function viewerOf(
  listCase: ListCase,
  rows: readonly PlayerListRow[],
): ViewerContext {
  return {
    membershipId:
      listCase.viewerIsMember && rows.length > 0
        ? rows[0].membershipId
        : VIEWER_MEMBERSHIP_ID,
    isAdmin: listCase.viewerIsAdmin,
  };
}

// --- Rendering ---------------------------------------------------------------

/** One rendered row: its membership identity and the state painted on it. */
interface RenderedRow {
  readonly membershipId: string;
  readonly state: string;
}

/**
 * Render the Player_List over an input collection and read back the rendered rows
 * in document order.
 *
 * Nothing is stubbed but the callbacks: the component takes its rows as a prop and
 * navigates through a callback, so no router and no session are involved.
 */
function renderRows(
  rows: readonly PlayerListRow[],
  viewer: ViewerContext,
): { readonly container: HTMLElement; readonly rendered: readonly RenderedRow[] } {
  const { container } = render(
    <PlayerList
      squadId={SQUAD_ID}
      rows={rows}
      viewer={viewer}
      onOpenPlayer={vi.fn()}
      onPromote={vi.fn()}
      onEditGuest={vi.fn()}
    />,
  );

  const rendered = [
    ...container.querySelectorAll<HTMLElement>(PLAYER_ROW_SELECTOR),
  ].map((row) => ({
    membershipId: row.getAttribute(PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE) ?? '',
    state: row.getAttribute(MEMBERSHIP_STATE_ATTRIBUTE) ?? '',
  }));

  return { container, rendered };
}

/** The rendered membership identities, in rendered order. */
const renderedIdentities = (
  rendered: readonly RenderedRow[],
): readonly string[] => rendered.map((row) => row.membershipId);

// --- The assertions ----------------------------------------------------------

/**
 * One row per supplied row and no other identity — stated as a multiset equality
 * so a rendering that dropped one row and duplicated another cannot pass, which
 * would otherwise let the order claims quantify over the wrong set.
 */
function expectRenderedSetMatchesInput(
  rows: readonly PlayerListRow[],
  rendered: readonly RenderedRow[],
): void {
  expect(rendered).toHaveLength(rows.length);
  expect([...renderedIdentities(rendered)].sort()).toEqual(
    rows.map((row) => row.membershipId).sort(),
  );
}

/**
 * Requirement 7.4's first key, read from the rendered rows alone: once an inactive
 * row has appeared, no active row follows it. Asserted from the state painted on
 * each row rather than from the model, so the claim is about the document.
 */
function expectActiveRowsRenderFirst(rendered: readonly RenderedRow[]): void {
  const firstInactive = rendered.findIndex((row) => row.state === 'inactive');

  if (firstInactive < 0) {
    return;
  }

  for (const row of rendered.slice(firstInactive)) {
    expect(row.state).toBe('inactive');
  }
}

/**
 * Requirement 7.4: the rendered sequence is the rule's sequence, it is the one the
 * single comparator yields, and consecutive rows are strictly ascending under the
 * rule — the last being what makes the order *total* rather than merely
 * sorted-looking.
 */
function expectRenderedOrderIsThePlayerOrder(
  rows: readonly PlayerListRow[],
  rendered: readonly RenderedRow[],
): void {
  const identities = renderedIdentities(rendered);

  // The rule as restated in this file, independently of the implementation.
  expect(identities).toEqual(expectedIdentityOrder(rows));

  // And the component orders through the one comparator rather than holding an
  // ordering of its own.
  expect(identities).toEqual(
    [...rows].sort(comparePlayerRows).map((row) => row.membershipId),
  );

  const byIdentity = new Map(rows.map((row) => [row.membershipId, row] as const));

  for (let index = 1; index < identities.length; index += 1) {
    const previous = byIdentity.get(identities[index - 1]);
    const current = byIdentity.get(identities[index]);

    expect(previous).toBeDefined();
    expect(current).toBeDefined();
    expect(
      compareByRule(previous as PlayerListRow, current as PlayerListRow),
    ).toBe(-1);
  }
}

/**
 * Requirement 7.4's last key: two rows whose names collate **equal** in the same
 * state are separated by ascending membership identity, and by nothing else.
 *
 * Stated over the pairs that actually reach the tie-break, so a comparison that
 * dropped the identity key — leaving equal-collating rows in whatever order they
 * arrived in — fails here even on the run where that order happened to look right.
 */
function expectEqualNamesBreakByIdentity(
  rows: readonly PlayerListRow[],
  rendered: readonly RenderedRow[],
): void {
  const position = new Map(
    renderedIdentities(rendered).map((identity, index) => [identity, index] as const),
  );

  for (const left of rows) {
    for (const right of rows) {
      if (left.membershipId === right.membershipId) {
        continue;
      }

      const sameState = stateRank(left.state) === stateRank(right.state);
      const sameName =
        baseCollator.compare(left.displayName, right.displayName) === 0;

      if (!sameState || !sameName) {
        continue;
      }

      const leftFirst =
        (position.get(left.membershipId) ?? -1) <
        (position.get(right.membershipId) ?? -1);

      expect(leftFirst).toBe(left.membershipId < right.membershipId);
    }
  }
}

/**
 * The order is total: every pair of distinct rows is ordered, the rendered
 * positions agree with the rule for all of them, and no two distinct rows are left
 * indistinguishable.
 */
function expectEveryPairIsOrdered(
  rows: readonly PlayerListRow[],
  rendered: readonly RenderedRow[],
): void {
  const position = new Map(
    renderedIdentities(rendered).map((identity, index) => [identity, index] as const),
  );

  for (const left of rows) {
    for (const right of rows) {
      const comparison = compareByRule(left, right);

      if (left.membershipId === right.membershipId) {
        expect(comparison).toBe(0);
        continue;
      }

      // Antisymmetric, and never equal for two distinct memberships.
      expect(comparison).not.toBe(0);
      expect(compareByRule(right, left)).toBe(comparison === -1 ? 1 : -1);

      const leftPosition = position.get(left.membershipId) ?? -1;
      const rightPosition = position.get(right.membershipId) ?? -1;

      expect(leftPosition).toBeGreaterThanOrEqual(0);
      expect(rightPosition).toBeGreaterThanOrEqual(0);
      expect(leftPosition < rightPosition).toBe(comparison === -1);
    }
  }
}

/**
 * Requirement 7.12 as the boundary of this property: an empty input renders the
 * statement and no list, and every non-empty input renders the list. Asserted
 * beside the order so "no row out of place" cannot be satisfied by rendering no
 * rows at all.
 */
function expectSurfaceMatchesInput(
  container: HTMLElement,
  rows: readonly PlayerListRow[],
): void {
  if (rows.length === 0) {
    expect(container.querySelector(PLAYER_LIST_SELECTOR)).toBeNull();
    expect(container.querySelector(PLAYER_LIST_EMPTY_SELECTOR)).not.toBeNull();
  } else {
    expect(container.querySelector(PLAYER_LIST_SELECTOR)).not.toBeNull();
    expect(container.querySelector(PLAYER_LIST_EMPTY_SELECTOR)).toBeNull();
  }
}

// --- The property ------------------------------------------------------------

describe('Property 15 — the Player_Order is a total order determined solely by its input', () => {
  // Feature: web-squads-screens, Property 15: The Player_Order is a total order determined solely by its input
  // Validates: Requirements 7.4, 20.6
  it('renders active rows first, then by name case-insensitively, then by membership identity', () => {
    fc.assert(
      fc.property(
        listCaseArb(collectionArb).chain((listCase) =>
          // The composed list is handed over **shuffled**, so the rendered order
          // can owe nothing to the order the caller supplied.
          permutationArb(composedRowsOf(listCase)).map((supplied) => ({
            listCase,
            supplied,
          })),
        ),
        ({ listCase, supplied }) => {
          const { container, rendered } = renderRows(
            supplied,
            viewerOf(listCase, supplied),
          );

          try {
            expectSurfaceMatchesInput(container, supplied);
            expectRenderedSetMatchesInput(supplied, rendered);
            expectActiveRowsRenderFirst(rendered);
            expectRenderedOrderIsThePlayerOrder(supplied, rendered);
            expectEqualNamesBreakByIdentity(supplied, rendered);
            expectEveryPairIsOrdered(supplied, rendered);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 15: The Player_Order is a total order determined solely by its input
  // Validates: Requirements 7.4, 20.6
  it('renders the identical row sequence for any two permutations of the same input', () => {
    fc.assert(
      fc.property(
        listCaseArb(collectionArb)
          .filter((listCase) => listCase.members.length >= 2)
          .chain((listCase) => {
            const rows = composedRowsOf(listCase);

            return fc.record({
              listCase: fc.constant(listCase),
              first: permutationArb(rows),
              second: permutationArb(rows),
            });
          }),
        ({ listCase, first, second }) => {
          const orderOf = (
            supplied: readonly PlayerListRow[],
          ): readonly string[] => {
            const { rendered } = renderRows(supplied, viewerOf(listCase, supplied));

            try {
              return renderedIdentities(rendered);
            } finally {
              cleanup();
            }
          };

          const firstOrder = orderOf(first);
          const secondOrder = orderOf(second);

          // 20.6: the rendered order is a function of the row set alone, so a
          // `GetSquad` response that arrived in a different order — and `GetSquad`
          // promises no order — cannot rearrange a person's player list between two
          // loads of the same squad.
          expect(firstOrder).toEqual(secondOrder);
          // And that shared order is the rule's own, not merely a stable one.
          expect(firstOrder).toEqual(expectedIdentityOrder(first));
        },
      ),
      { numRuns: 150 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 15: The Player_Order is a total order determined solely by its input
  // Validates: Requirements 7.4, 20.6
  it('renders a 200-row list whose names repeat in the rule’s sequence', () => {
    fc.assert(
      fc.property(
        listCaseArb(largeCollectionArb).chain((listCase) =>
          permutationArb(composedRowsOf(listCase)).map((supplied) => ({
            listCase,
            supplied,
          })),
        ),
        ({ listCase, supplied }) => {
          const { rendered } = renderRows(supplied, viewerOf(listCase, supplied));

          try {
            // Forty rows per name across two state blocks: nearly every position is
            // decided by the identity tie-break rather than by the name.
            expect(rendered).toHaveLength(200);
            expectRenderedSetMatchesInput(supplied, rendered);
            expectActiveRowsRenderFirst(rendered);
            // Every permutation renders the rule's sequence, so any two of them
            // render the same sequence — the permutation claim at this size,
            // without paying for a second render of 200 rows on every run. The
            // sequence equality also carries the tie-break for all 200 rows, so the
            // quadratic pair walk is left to the smaller property above.
            expectRenderedOrderIsThePlayerOrder(supplied, rendered);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);
});
