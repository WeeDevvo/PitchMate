import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  formatDisplayRating,
  selectRatingPresentation,
  type RatingPresentation,
} from './ratingPresentation';
import type { MembershipState, RatingState, SquadRole } from './wireEnums';
import type {
  DisplayRatingEntry,
  DisplayRatingLeaderboard,
} from './parse/leaderboard';
import type { SquadMember } from './parse/squadDetail';

/**
 * Property tests for the Rating_Presentation selection, beside the module they
 * cover as the design's Testing Strategy asks, and running well above the
 * 100-iteration floor (Requirements 20.1, 20.7).
 *
 * `web-player-stats-screen` Requirement 17.1 allows a Player_Row exactly **one**
 * of four conditions, and Requirement 20.7 asks for that "exactly one" to be a
 * property over generated input rather than a rendering convention. The type
 * already stops a value carrying a number *and* claiming to be provisional, so
 * what these tests are for is the part the type cannot state: that the *branch
 * chosen* is the one the acceptance criteria name, for every shape of input the
 * screen can hand over.
 *
 * Five claims are made:
 *
 * - **Exactly one presentation, for every input.** Stated against an
 *   independently written oracle — the branches read off Requirements 8.1, 8.3,
 *   8.10 and `web-player-stats-screen` 17.2 rather than derived from the module's
 *   own comparisons, and using explicit `NaN` / `±Infinity` tests rather than the
 *   `Number.isFinite` call the module makes, so an inverted guard cannot agree
 *   with both. Cross-checked structurally: exactly one of the four tag predicates
 *   holds, and the returned object carries exactly the keys that tag permits.
 * - **The four branches are exact at their boundaries.** An absent leaderboard is
 *   `unavailable` however the member is shaped (Requirement 7.10 routes the failed,
 *   timed-out, still-in-flight, and parser-rejected leaderboard here, including
 *   Requirement 8.11's duplicate-identity body). A provisional Rating_State is a
 *   band whether or not the leaderboard names the membership. A played, settled
 *   row the leaderboard does not name — and one whose value is not finite — is
 *   `unavailable` and carries no numeric value (Requirements 8.3, 8.10).
 *   Everything else is `rating`.
 * - **Three member fields are read, and no others:** the membership identity, the
 *   Appearance_Count, and the Rating_State. Requirement 8.12 forbids a band from
 *   varying with Membership_State, Guest_Flag, Member_Role, or leaderboard size.
 *   Asserting equal results across those fields would leave a future branch free
 *   to read one of them and coincidentally agree, so the stronger form is
 *   asserted directly: a recording `Proxy` around the member shows that those
 *   three are the only properties the function touches, and nothing at all is
 *   touched when the leaderboard is absent.
 * - **The selection is pure and total.** Equal inputs give equal results
 *   (Requirement 8.6), repeated and interleaved calls agree, nothing throws, and
 *   neither the member nor the leaderboard is mutated.
 * - **The amendment is four-valued over the whole table** — Property 38 of
 *   `web-player-stats-screen`, in the final section. The four dimensions the
 *   amendment turns on are enumerated as a closed cross-product and *every* cell
 *   is asserted on *every* run, rather than sampled one cell at a time: exactly
 *   one of the four kinds is resolved, it is the kind `web-player-stats-screen`
 *   Requirement 17.2 names, and a zero-appearance or provisional row carries no
 *   number anywhere in it.
 *
 * What is deliberately **not** claimed here: the rounding rule itself. Requirement
 * 8.2's half-away-from-zero behaviour, the decimal-integer rendering of
 * Requirement 8.1, and the "no value computed from μ, σ, K, or C" clause of
 * Requirement 8.9 belong to **Property 20** in `displayRatingFormat.property.test.ts`.
 * Rounding is touched here only where the `rating` branch's value has to *be*
 * `formatDisplayRating(entry.value)` — the claim that the branch reports that
 * entry's value, not a claim about what the rounding does to it. The rendered-row
 * clauses (the badge, the accessible name, the identical copy on every row) are
 * claimed by Properties 21 and 40 at the rendering site.
 *
 * The generators lean on the cases where the branches meet: a matching entry sits
 * at every position among non-matching ones, values include `NaN`, both
 * infinities, `-0`, and magnitudes at the top of the double range, and leaderboards
 * run from empty through 200 entries. Identities are generated **distinct**
 * throughout, because Requirement 8.11 has the parser reject a body with a repeated
 * identity — a leaderboard with duplicates never reaches this function, so
 * generating one would test an input space the feature has already excluded. Each
 * property re-checks that distinctness rather than trusting the generator.
 */

// --- the input space ---------------------------------------------------------

/** Every Member_Role a Squad_Member can carry, plus the guest's absence. */
const roleArb: fc.Arbitrary<SquadRole | null> = fc.constantFrom(
  'Owner' as const,
  'Admin' as const,
  'Member' as const,
  null,
);

/** Both Membership_States; a parsed Squad_Member always carries one. */
const stateArb: fc.Arbitrary<MembershipState> = fc.constantFrom(
  'Active' as const,
  'Inactive' as const,
);

/** A display name, including the empty string and a case-varying family. */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.constantFrom('Dave', 'dave', 'DAVE', 'Former player', ''),
);

/** Every Rating_State a membership can carry, plus the absence of one. */
const ratingStateArb: fc.Arbitrary<RatingState | null> = fc.constantFrom(
  'Provisional' as const,
  'Established' as const,
  null,
);

/**
 * The two fields the selection reads besides the membership identity: the
 * Appearance_Count and the Rating_State.
 *
 * Supplied as arbitraries rather than values so a property can narrow one of
 * them — several below need "a member who has played and is not provisional", so
 * that the branch they are about is the branch that fires.
 */
interface RatingFieldArbs {
  readonly appearances: fc.Arbitrary<number>;
  readonly ratingState: fc.Arbitrary<RatingState | null>;
}

/** Any Appearance_Count and any Rating_State: the whole admitted space. */
const ANY_RATING_FIELDS: RatingFieldArbs = {
  appearances: fc.nat({ max: 200 }),
  ratingState: ratingStateArb,
};

/** A member who has played and whose rating is not provisional. */
const SETTLED_RATING_FIELDS: RatingFieldArbs = {
  appearances: fc.integer({ min: 1, max: 200 }),
  ratingState: fc.constantFrom('Established' as const, null),
};

/** A member who has played and whose rating is still settling. */
const PROVISIONAL_RATING_FIELDS: RatingFieldArbs = {
  appearances: fc.integer({ min: 1, max: 200 }),
  ratingState: fc.constant('Provisional' as const),
};

/**
 * A Squad_Member with a generated identity, role, state, Guest_Flag,
 * Appearance_Count, and Rating_State.
 */
function memberWithIdentity(
  membershipId: string,
  fields: RatingFieldArbs = ANY_RATING_FIELDS,
): fc.Arbitrary<SquadMember> {
  return fc.record({
    membershipId: fc.constant(membershipId),
    displayName: displayNameArb,
    role: roleArb,
    state: stateArb,
    isGuest: fc.boolean(),
    appearances: fields.appearances,
    ratingState: fields.ratingState,
  });
}

const memberArb: fc.Arbitrary<SquadMember> = fc
  .uuid()
  .chain((membershipId) => memberWithIdentity(membershipId));

/** A member whose Appearance_Count and Rating_State leave the rating branches free. */
const settledMemberArb: fc.Arbitrary<SquadMember> = fc
  .uuid()
  .chain((membershipId) => memberWithIdentity(membershipId, SETTLED_RATING_FIELDS));

/** A member whose Rating_State sends every row of theirs to the band. */
const provisionalMemberArb: fc.Arbitrary<SquadMember> = fc
  .uuid()
  .chain((membershipId) => memberWithIdentity(membershipId, PROVISIONAL_RATING_FIELDS));

/**
 * Values a matching entry can carry and still be finite, so the `rating` branch
 * must take them: ordinary doubles, both signed zeroes, the exact halves, and
 * magnitudes at the top of the double range. `-0` and `Number.MAX_VALUE` are here
 * because they are the two ways a reader might expect "not a normal number" to
 * mean "not finite" — neither is.
 */
const finiteValueArb: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }), weight: 4 },
  {
    arbitrary: fc.constantFrom(
      0,
      -0,
      0.5,
      -0.5,
      1.5,
      -2.5,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      1e308,
      -1e308,
      2 ** 60,
      -(2 ** 60),
    ),
    weight: 3,
  },
);

/** The three values Requirement 8.10 treats as carrying no rating at all. */
const nonFiniteValueArb: fc.Arbitrary<number> = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

/** Any value a parsed entry might carry, finite or not. */
const anyValueArb: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: finiteValueArb, weight: 4 },
  { arbitrary: nonFiniteValueArb, weight: 1 },
);

/** One leaderboard entry for a given identity. */
function entryFor(
  membershipId: string,
  valueArb: fc.Arbitrary<number>,
): fc.Arbitrary<DisplayRatingEntry> {
  return fc.record({
    membershipId: fc.constant(membershipId),
    displayName: displayNameArb,
    value: valueArb,
  });
}

/**
 * Entries for identities other than `membershipId`, distinct from each other —
 * the decoration around the row under test, which must contribute nothing to it.
 */
function otherEntriesArb(
  membershipId: string,
  maxLength = 8,
): fc.Arbitrary<DisplayRatingEntry[]> {
  return fc
    .uniqueArray(
      fc.uuid().chain((otherId) => entryFor(otherId, anyValueArb)),
      { selector: (entry) => entry.membershipId, maxLength },
    )
    .map((entries) =>
      entries.filter((entry) => entry.membershipId !== membershipId),
    );
}

/**
 * A leaderboard that carries **no** entry for `membershipId`, including the empty
 * one — the shape Requirement 8.3 names.
 */
function leaderboardWithoutMatch(
  membershipId: string,
): fc.Arbitrary<DisplayRatingLeaderboard> {
  return otherEntriesArb(membershipId).map((entries) => ({ entries }));
}

/**
 * A leaderboard carrying exactly one entry for `membershipId`, placed at an
 * arbitrary position among entries for other identities — so a first-element or
 * last-element assumption in the lookup is exercised rather than assumed away.
 */
function leaderboardWithMatch(
  membershipId: string,
  valueArb: fc.Arbitrary<number>,
): fc.Arbitrary<{
  readonly leaderboard: DisplayRatingLeaderboard;
  readonly matching: DisplayRatingEntry;
}> {
  return fc
    .tuple(
      otherEntriesArb(membershipId),
      entryFor(membershipId, valueArb),
      fc.nat({ max: 32 }),
    )
    .map(([others, matching, position]) => {
      const entries = others.slice();

      entries.splice(position % (others.length + 1), 0, matching);

      return { leaderboard: { entries }, matching };
    });
}

interface SelectionCase {
  readonly member: SquadMember;
  readonly leaderboard: DisplayRatingLeaderboard | null;
}

/**
 * The whole input space in one arbitrary: an absent leaderboard, a leaderboard
 * with a matching entry (finite and not), and a leaderboard with none.
 */
const selectionCaseArb: fc.Arbitrary<SelectionCase> = memberArb.chain((member) =>
  fc.oneof(
    { arbitrary: fc.constant<SelectionCase>({ member, leaderboard: null }), weight: 1 },
    {
      arbitrary: leaderboardWithMatch(member.membershipId, anyValueArb).map(
        ({ leaderboard }) => ({ member, leaderboard }),
      ),
      weight: 3,
    },
    {
      arbitrary: leaderboardWithoutMatch(member.membershipId).map((leaderboard) => ({
        member,
        leaderboard,
      })),
      weight: 2,
    },
  ),
);

// --- the oracle --------------------------------------------------------------

/**
 * The four branches written straight out of the acceptance criteria rather than
 * out of the module.
 *
 * Two deliberate differences from the implementation keep this an independent
 * statement: the lookup collects **every** matching entry and demands exactly one
 * (Requirement 8.1's "carries exactly one entry"), rather than taking the first
 * match; and the finiteness test is spelled out as the three excluded values of
 * Requirement 8.10 rather than delegated to `Number.isFinite`. The rounding is
 * shared with the module on purpose — the `rating` branch's obligation here is to
 * report *that entry's* value formatted, and what the formatting does to it is
 * Property 20's claim.
 *
 * The two middle branches come from `web-player-stats-screen` Requirement 17.2,
 * and their **order** is part of the statement: a member can have played nothing
 * *and* carry a provisional state, and the never-played condition is the one that
 * must be reported.
 */
function oraclePresentation(
  member: SquadMember,
  leaderboard: DisplayRatingLeaderboard | null,
): RatingPresentation {
  // 7.10, 8.11: no usable leaderboard body reached the screen.
  if (leaderboard === null) {
    return { kind: 'unavailable' };
  }

  // player-stats 17.2: nothing has been played, so nothing can be rated.
  if (member.appearances === 0) {
    return { kind: 'never-played' };
  }

  // player-stats 17.2: a rating that is still settling is not shown as a number.
  if (member.ratingState === 'Provisional') {
    return { kind: 'provisional' };
  }

  const matching = leaderboard.entries.filter(
    (entry) => entry.membershipId === member.membershipId,
  );

  // 8.3: no entry names this membership, so no rating was obtained for this row.
  if (matching.length !== 1) {
    return { kind: 'unavailable' };
  }

  const value = matching[0].value;

  // 8.10: a value that is not a finite number says nothing about the player.
  if (
    Number.isNaN(value) ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY
  ) {
    return { kind: 'unavailable' };
  }

  // 8.1: this row's own entry value, formatted.
  return { kind: 'rating', value: formatDisplayRating(value) };
}

// --- shared assertions -------------------------------------------------------

/**
 * Requirement 8.11 has the parser reject a leaderboard with a repeated identity,
 * so every generated leaderboard must carry distinct identities. Re-checked inside
 * each property rather than trusted, so a generator change cannot quietly widen
 * the input space past what the feature admits.
 */
function expectDistinctIdentities(leaderboard: DisplayRatingLeaderboard | null): void {
  if (leaderboard === null) {
    return;
  }

  const identities = leaderboard.entries.map((entry) => entry.membershipId);

  expect(new Set(identities).size).toBe(identities.length);
}

/**
 * The structural half of "exactly one presentation": one tag out of four, and
 * exactly the keys that tag permits — so a `provisional` result cannot smuggle a
 * number alongside it, and a `rating` result cannot omit one.
 */
function expectExactlyOnePresentation(presentation: RatingPresentation): void {
  const isRating = presentation.kind === 'rating';
  const isProvisional = presentation.kind === 'provisional';
  const isNeverPlayed = presentation.kind === 'never-played';
  const isUnavailable = presentation.kind === 'unavailable';

  expect(
    [isRating, isProvisional, isNeverPlayed, isUnavailable].filter(Boolean),
  ).toHaveLength(1);

  if (presentation.kind === 'rating') {
    expect(Object.keys(presentation).sort()).toEqual(['kind', 'value']);
    expect(typeof presentation.value).toBe('number');
    expect(Number.isFinite(presentation.value)).toBe(true);
  } else {
    // 8.12, 8.13: the three non-numeric presentations carry no payload at all, so
    // there is nowhere for row-dependent copy or a numeric value to live.
    expect(Object.keys(presentation)).toEqual(['kind']);
  }
}

/** A deep structural snapshot, for the no-mutation claims. */
function snapshot(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === 'number' && !Number.isFinite(entry) ? String(entry) : entry,
  );
}

// Feature: web-squads-screens, Property 19: Exactly one Rating_Presentation is selected for every input
// Validates: Requirements 8.5, 8.6, 20.7
describe('selectRatingPresentation — exactly one presentation for every input', () => {
  it('agrees with the acceptance criteria on every generated input', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
        expectDistinctIdentities(leaderboard);

        // The oracle states the three branches independently, so this compares
        // against the criteria rather than restating the implementation.
        expect(selectRatingPresentation(member, leaderboard)).toEqual(
          oraclePresentation(member, leaderboard),
        );
      }),
      { numRuns: 600 },
    );
  });

  it('returns exactly one of the four presentations, carrying only that tag payload', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
        expectExactlyOnePresentation(selectRatingPresentation(member, leaderboard));
      }),
      { numRuns: 600 },
    );
  });

  it('selects a presentation for a leaderboard of 0, 1, and 200 entries without throwing', () => {
    fc.assert(
      fc.property(
        settledMemberArb,
        fc.constantFrom(0, 1, 200),
        fc.boolean(),
        (member, size, includeMember) => {
          const entries: DisplayRatingEntry[] = Array.from(
            { length: size },
            (_unused, index) => ({
              membershipId:
                includeMember && index === Math.floor(size / 2)
                  ? member.membershipId
                  : `entry-${String(index)}-${member.membershipId}`,
              displayName: `Player ${String(index)}`,
              value: index,
            }),
          );

          const presentation = selectRatingPresentation(member, { entries });

          expectExactlyOnePresentation(presentation);
          // The member has played and is not provisional, so the only question
          // left is whether the leaderboard names them.
          expect(presentation.kind).toBe(
            includeMember && size > 0 ? 'rating' : 'unavailable',
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 19: Exactly one Rating_Presentation is selected for every input
// Validates: Requirements 8.3, 8.5, 8.6, 8.10
describe('selectRatingPresentation — the four branches are exact', () => {
  it('yields Rating_Unavailable whenever no leaderboard was obtained', () => {
    fc.assert(
      fc.property(memberArb, (member) => {
        // 7.10: the leaderboard call failed, timed out, is still in flight, or its
        // body was rejected — including Requirement 8.11's duplicate-identity body.
        // Every one of those arrives as `null`, and no member shape escapes it.
        expect(selectRatingPresentation(member, null)).toEqual({ kind: 'unavailable' });
      }),
      { numRuns: 300 },
    );
  });

  it('yields the Provisional_Band for a provisional Rating_State, matching entry or not', () => {
    fc.assert(
      fc.property(
        provisionalMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            leaderboard: fc.oneof(
              leaderboardWithoutMatch(member.membershipId),
              leaderboardWithMatch(member.membershipId, anyValueArb).map(
                ({ leaderboard }) => leaderboard,
              ),
            ),
          }),
        ),
        ({ member, leaderboard }) => {
          expectDistinctIdentities(leaderboard);

          // player-stats 17.2: a rating that is still settling is a band and no
          // numeric value, even when the leaderboard does carry a value for this
          // membership — the band is the statement, not a fallback.
          expect(selectRatingPresentation(member, leaderboard)).toEqual({
            kind: 'provisional',
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('yields Rating_Unavailable for a played, settled row the leaderboard does not name', () => {
    fc.assert(
      fc.property(
        settledMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            leaderboard: leaderboardWithoutMatch(member.membershipId),
          }),
        ),
        ({ member, leaderboard }) => {
          expectDistinctIdentities(leaderboard);

          // 8.3, and player-stats 17.2's residual: this player has played and is
          // not provisional, so an absent entry is a rating that was not
          // obtained rather than a rating that is still settling.
          expect(selectRatingPresentation(member, leaderboard)).toEqual({
            kind: 'unavailable',
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('yields Rating_Unavailable when the matching entry value is NaN or an infinity', () => {
    fc.assert(
      fc.property(
        settledMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, nonFiniteValueArb),
          }),
        ),
        ({ member, match }) => {
          expectDistinctIdentities(match.leaderboard);

          // 8.10: an unusable value collapses onto the same statement as an absent
          // entry rather than becoming a fifth case of its own.
          expect(selectRatingPresentation(member, match.leaderboard)).toEqual({
            kind: 'unavailable',
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('yields a Display_Rating reporting the matching entry value when it is finite', () => {
    fc.assert(
      fc.property(
        settledMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, finiteValueArb),
          }),
        ),
        ({ member, match }) => {
          expectDistinctIdentities(match.leaderboard);

          // 8.1: the row's own entry, formatted. `-0` and a magnitude at the top of
          // the double range are finite, so both land here rather than on the band.
          // What the formatting does to the number is Property 20's claim.
          expect(selectRatingPresentation(member, match.leaderboard)).toEqual({
            kind: 'rating',
            value: formatDisplayRating(match.matching.value),
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  it('takes the Display_Rating branch for minus zero and for very large magnitudes', () => {
    fc.assert(
      fc.property(
        settledMemberArb,
        fc.constantFrom(
          -0,
          0,
          Number.MAX_VALUE,
          -Number.MAX_VALUE,
          Number.MAX_SAFE_INTEGER,
          -Number.MAX_SAFE_INTEGER,
          1e308,
          -1e308,
        ),
        (member, value) => {
          const presentation = selectRatingPresentation(member, {
            entries: [
              { membershipId: member.membershipId, displayName: 'Anyone', value },
            ],
          });

          // These are the values most likely to be mistaken for "not a number":
          // every one of them is finite, so none may reach the Provisional_Band.
          expect(presentation).toEqual({
            kind: 'rating',
            value: formatDisplayRating(value),
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reads the matching entry alone, ignoring what every other entry carries', () => {
    fc.assert(
      fc.property(
        memberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, anyValueArb),
            replacements: fc.array(anyValueArb, { maxLength: 8 }),
          }),
        ),
        ({ member, match, replacements }) => {
          const disturbed: DisplayRatingLeaderboard = {
            entries: match.leaderboard.entries.map((entry, index) =>
              entry.membershipId === member.membershipId
                ? entry
                : {
                    ...entry,
                    displayName: `Disturbed ${String(index)}`,
                    value: replacements[index % Math.max(replacements.length, 1)] ?? 0,
                  },
            ),
          };

          // 8.9: every rendered value comes from this row's own entry, so rewriting
          // the rest of the leaderboard cannot move the row's presentation.
          expect(selectRatingPresentation(member, disturbed)).toEqual(
            selectRatingPresentation(member, match.leaderboard),
          );
        },
      ),
      { numRuns: 400 },
    );
  });
});

// Feature: web-squads-screens, Property 19: the presentation reads only the
// membership identity, the Appearance_Count, and the Rating_State
// Validates: Requirements 8.6, 8.12
describe('selectRatingPresentation — three member fields are read, and no others', () => {
  /**
   * Records the member properties the function touches. Stronger than comparing
   * results across generated field values: a branch that read `state` and happened
   * to agree would pass that comparison and fail this.
   */
  function trackedMember(member: SquadMember): {
    readonly tracked: SquadMember;
    readonly reads: readonly string[];
  } {
    const reads: string[] = [];
    const tracked = new Proxy(member, {
      get(target, property, receiver) {
        if (typeof property === 'string') {
          reads.push(property);
        }

        return Reflect.get(target, property, receiver);
      },
    });

    return { tracked, reads };
  }

  /**
   * The three fields the amended selection is permitted to read: the membership
   * identity, and the two Requirement 17.2 of `web-player-stats-screen` names.
   */
  const READABLE_FIELDS: readonly string[] = [
    'membershipId',
    'appearances',
    'ratingState',
  ];

  it('touches no member property other than the three it is permitted', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
        const { tracked, reads } = trackedMember(member);

        selectRatingPresentation(tracked, leaderboard);

        // 8.12: Membership_State, Guest_Flag, Member_Role, and Player_Display_Name
        // are never consulted, so no band can acquire a tell through a branch
        // added later. The list is closed rather than growing with the module: a
        // fourth field would fail here before anyone had to notice.
        expect(reads.filter((property) => !READABLE_FIELDS.includes(property))).toEqual(
          [],
        );
      }),
      { numRuns: 500 },
    );
  });

  it('touches no member property at all when no leaderboard was obtained', () => {
    fc.assert(
      fc.property(memberArb, (member) => {
        const { tracked, reads } = trackedMember(member);

        expect(selectRatingPresentation(tracked, null)).toEqual({
          kind: 'unavailable',
        });
        expect(reads).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('gives the same presentation however the role, state, guest flag, and name differ', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(fc.uuid(), fc.nat({ max: 200 }), ratingStateArb)
          .chain(([membershipId, appearances, ratingState]) => {
            // The two members agree on exactly the three fields the selection is
            // allowed to read, and are generated independently in everything
            // else — so any difference in the result can only come from a field
            // Requirement 8.12 puts out of bounds.
            const sharedFields: RatingFieldArbs = {
              appearances: fc.constant(appearances),
              ratingState: fc.constant(ratingState),
            };

            return fc.record({
              first: memberWithIdentity(membershipId, sharedFields),
              second: memberWithIdentity(membershipId, sharedFields),
              leaderboard: fc.oneof(
                fc.constant(null),
                leaderboardWithoutMatch(membershipId),
                leaderboardWithMatch(membershipId, anyValueArb).map(
                  ({ leaderboard }) => leaderboard,
                ),
              ),
            });
          }),
        ({ first, second, leaderboard }) => {
          expectDistinctIdentities(leaderboard);

          // Two members sharing those three fields and differing in everything
          // else are presented identically — the observable form of 8.12.
          expect(selectRatingPresentation(first, leaderboard)).toEqual(
            selectRatingPresentation(second, leaderboard),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('gives one identical Provisional_Band however large the leaderboard is', () => {
    fc.assert(
      fc.property(
        provisionalMemberArb,
        fc.array(fc.constantFrom(0, 1, 5, 50, 200), { minLength: 2, maxLength: 5 }),
        (member, sizes) => {
          const presentations = sizes.map((size) =>
            selectRatingPresentation(member, {
              entries: Array.from({ length: size }, (_unused, index) => ({
                membershipId: `other-${String(index)}-${member.membershipId}`,
                displayName: `Player ${String(index)}`,
                value: index,
              })),
            }),
          );

          // 8.12: the band does not vary with how many entries the leaderboard
          // carries, so it distinguishes no cause for the absence.
          for (const presentation of presentations) {
            expect(presentation).toEqual({ kind: 'provisional' });
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 19: the selection is a pure, total function
// Validates: Requirements 8.5, 8.6, 20.7
describe('selectRatingPresentation — the selection is pure and total', () => {
  it('returns equal results for equal inputs', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
        // 8.6: the Player_List is composed on every render; two renders holding the
        // same parsed values must not disagree about a row's rating.
        expect(selectRatingPresentation(member, leaderboard)).toEqual(
          selectRatingPresentation(member, leaderboard),
        );
      }),
      { numRuns: 400 },
    );
  });

  it('depends on nothing but its two arguments, in order', () => {
    fc.assert(
      fc.property(selectionCaseArb, selectionCaseArb, (first, second) => {
        const firstPresentation = selectRatingPresentation(
          first.member,
          first.leaderboard,
        );

        // An interleaved call for an unrelated row changes nothing, so the function
        // holds no state between calls.
        selectRatingPresentation(second.member, second.leaderboard);

        expect(selectRatingPresentation(first.member, first.leaderboard)).toEqual(
          firstPresentation,
        );
      }),
      { numRuns: 400 },
    );
  });

  it('mutates neither the member nor the leaderboard', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
        const before = snapshot({ member, leaderboard });

        selectRatingPresentation(member, leaderboard);

        expect(snapshot({ member, leaderboard })).toBe(before);
      }),
      { numRuns: 400 },
    );
  });
});
// --- Property 38: the amendment, combination by combination ------------------

/**
 * The amended selection, stated as a **table** rather than as a sampling.
 *
 * Everything above samples the input space: the member's identity, role, name,
 * and the decoration around the row are generated, and the branch under test is
 * narrowed by the generator. `web-player-stats-screen` Requirement 17.1 asks for
 * something slightly different — that *exactly one* of **four** conditions is
 * resolved, for every shape of input — and the four branches now interact
 * (a member can have played nothing, carry a provisional state, and have a
 * leaderboard entry with an unusable value, all at once). A generator that picks
 * one combination per run leaves the awkward ones to luck: there are 126 of them,
 * and coupon-collecting all 126 out of a few hundred runs is likely rather than
 * certain.
 *
 * So the dimensions the task names are enumerated as a closed cross-product —
 * leaderboard absent / present-without-match / present-with-match, entry value
 * `NaN` / `+∞` / `−∞` / `-0` / very large of either sign / ordinary,
 * Appearance_Count zero / positive, and Rating_State provisional / established /
 * absent — and **every** combination is asserted on **every** run, with the
 * randomness supplying the surrounding member and leaderboard shape. Each run is
 * therefore a complete pass over the table, and a combination cannot be missed.
 *
 * The expected kind is read off the acceptance criteria at the level of these
 * tokens (`expectedKindFor`), independently of `oraclePresentation` above and of
 * the module: no `Number.isFinite` call, no entry lookup, just the four
 * conditions in the order Requirement 17.2 puts them.
 */

/** Whether a leaderboard was obtained, and whether it names the row's membership. */
type LeaderboardShape = 'absent' | 'without-match' | 'with-match';

const LEADERBOARD_SHAPES: readonly LeaderboardShape[] = [
  'absent',
  'without-match',
  'with-match',
];

/**
 * The entry values Property 38 singles out, by name.
 *
 * The first three are Requirement 8.10's unusable values. `-0` and the two
 * very-large magnitudes are the values most often mistaken for unusable ones:
 * every one of them is finite, so each must reach the `rating` branch. The
 * ordinary value is the control — without it, a module that sent *everything* to
 * `unavailable` would satisfy the rest of the table.
 */
const NAMED_ENTRY_VALUES = {
  nan: Number.NaN,
  'positive-infinity': Number.POSITIVE_INFINITY,
  'negative-infinity': Number.NEGATIVE_INFINITY,
  'minus-zero': -0,
  'very-large': Number.MAX_VALUE,
  'very-large-negative': -Number.MAX_VALUE,
  ordinary: 1234.5,
} as const;

type NamedEntryValue = keyof typeof NAMED_ENTRY_VALUES;

/** The named values, listed rather than derived, so the table is visible here. */
const NAMED_ENTRY_VALUE_KINDS: readonly NamedEntryValue[] = [
  'nan',
  'positive-infinity',
  'negative-infinity',
  'minus-zero',
  'very-large',
  'very-large-negative',
  'ordinary',
];

/** The three of those values Requirement 8.10 treats as carrying no rating. */
const UNUSABLE_ENTRY_VALUE_KINDS: readonly NamedEntryValue[] = [
  'nan',
  'positive-infinity',
  'negative-infinity',
];

/** The two Appearance_Counts that matter: none played, and some played. */
type AppearanceKind = 'zero' | 'positive';

const APPEARANCE_KINDS: readonly AppearanceKind[] = ['zero', 'positive'];

/** Every Rating_State a membership can carry, plus the absence of one. */
type RatingStateKind = RatingState | 'absent';

const RATING_STATE_KINDS: readonly RatingStateKind[] = [
  'Provisional',
  'Established',
  'absent',
];

/** One cell of the table: one choice on each of the four dimensions. */
interface PresentationCombination {
  readonly shape: LeaderboardShape;
  readonly value: NamedEntryValue;
  readonly appearances: AppearanceKind;
  readonly ratingState: RatingStateKind;
}

/**
 * The closed cross-product of the four dimensions: 3 × 7 × 2 × 3 = 126 cells.
 *
 * The entry value is carried even for the two shapes that have no matching entry
 * to put it on. Those cells are not redundant: they are the claim that the value
 * dimension cannot influence a row whose entry is absent, which is Requirement
 * 8.3's half of the statement.
 */
const PRESENTATION_COMBINATIONS: readonly PresentationCombination[] =
  LEADERBOARD_SHAPES.flatMap((shape) =>
    NAMED_ENTRY_VALUE_KINDS.flatMap((value) =>
      APPEARANCE_KINDS.flatMap((appearances) =>
        RATING_STATE_KINDS.map((ratingState) => ({
          shape,
          value,
          appearances,
          ratingState,
        })),
      ),
    ),
  );

/** A readable name for a cell, for a failure message that says which one failed. */
function combinationLabel(combination: PresentationCombination): string {
  return [
    `leaderboard=${combination.shape}`,
    `value=${combination.value}`,
    `appearances=${combination.appearances}`,
    `ratingState=${combination.ratingState}`,
  ].join(' ');
}

/**
 * The parts of the input the table does **not** fix: the member's identity and
 * the four fields Requirement 8.12 puts out of bounds, the positive
 * Appearance_Count's actual magnitude, the entries for other identities, and
 * where among them the matching entry sits.
 */
interface CombinationIngredients {
  readonly membershipId: string;
  readonly displayName: string;
  readonly role: SquadRole | null;
  readonly state: MembershipState;
  readonly isGuest: boolean;
  readonly positiveAppearances: number;
  readonly others: readonly DisplayRatingEntry[];
  readonly position: number;
  readonly entryDisplayName: string;
}

const combinationIngredientsArb: fc.Arbitrary<CombinationIngredients> = fc
  .uuid()
  .chain((membershipId) =>
    fc.record({
      membershipId: fc.constant(membershipId),
      displayName: displayNameArb,
      role: roleArb,
      state: stateArb,
      isGuest: fc.boolean(),
      positiveAppearances: fc.integer({ min: 1, max: 200 }),
      others: otherEntriesArb(membershipId),
      position: fc.nat({ max: 32 }),
      entryDisplayName: displayNameArb,
    }),
  );

/** The input one cell of the table describes, filled out with generated parts. */
function buildCombinationCase(
  combination: PresentationCombination,
  ingredients: CombinationIngredients,
): SelectionCase {
  const member: SquadMember = {
    membershipId: ingredients.membershipId,
    displayName: ingredients.displayName,
    role: ingredients.role,
    state: ingredients.state,
    isGuest: ingredients.isGuest,
    appearances:
      combination.appearances === 'zero' ? 0 : ingredients.positiveAppearances,
    ratingState:
      combination.ratingState === 'absent' ? null : combination.ratingState,
  };

  // 7.10: the absent leaderboard is a shape of its own, not an empty one.
  if (combination.shape === 'absent') {
    return { member, leaderboard: null };
  }

  const entries = ingredients.others.slice();

  if (combination.shape === 'with-match') {
    // Placed at a generated position among the others, so no first-element or
    // last-element assumption in the lookup survives.
    entries.splice(ingredients.position % (entries.length + 1), 0, {
      membershipId: ingredients.membershipId,
      displayName: ingredients.entryDisplayName,
      value: NAMED_ENTRY_VALUES[combination.value],
    });
  }

  return { member, leaderboard: { entries } };
}

/**
 * The kind the acceptance criteria name for a cell, in their stated order.
 *
 * Written over the table's tokens rather than over the values, so it shares no
 * comparison with the module: finiteness is a membership test against the three
 * named unusable kinds, and the matching entry is a dimension rather than a
 * lookup.
 */
function expectedKindFor(
  combination: PresentationCombination,
): RatingPresentation['kind'] {
  // 7.10, 8.11: nothing is known about any row.
  if (combination.shape === 'absent') {
    return 'unavailable';
  }

  // player-stats 17.2: nothing played, so nothing to rate — ahead of the band.
  if (combination.appearances === 'zero') {
    return 'never-played';
  }

  // player-stats 17.2: still settling, whatever the leaderboard carries.
  if (combination.ratingState === 'Provisional') {
    return 'provisional';
  }

  // 8.3: a played, settled row the leaderboard does not name.
  if (combination.shape === 'without-match') {
    return 'unavailable';
  }

  // 8.1, 8.10: this row's own entry, if its value is usable at all.
  return UNUSABLE_ENTRY_VALUE_KINDS.includes(combination.value)
    ? 'unavailable'
    : 'rating';
}

/**
 * That a presentation carries no number anywhere in it.
 *
 * Stronger than checking the `kind`: it reads every own property of the returned
 * object, so a band that grew a numeric payload — a raw value, an appearance
 * count, a threshold — fails here even while its tag still reads `provisional`.
 */
function expectNoNumericValue(presentation: RatingPresentation): void {
  const payload: Record<string, unknown> = { ...presentation };

  expect(
    Object.entries(payload).filter(([, value]) => typeof value === 'number'),
  ).toEqual([]);
}

// Feature: web-player-stats-screen, Property 38: The amended player-list presentation is total and four-valued
// Validates: Requirements 17.1, 17.2
describe('selectRatingPresentation — the amended presentation is total and four-valued', () => {
  it('enumerates every combination of leaderboard, entry value, appearances, and rating state', () => {
    // A guard on the table itself: the cross-product is complete and carries no
    // repeated cell, so "every combination" below means what it says.
    expect(PRESENTATION_COMBINATIONS).toHaveLength(
      LEADERBOARD_SHAPES.length *
        NAMED_ENTRY_VALUE_KINDS.length *
        APPEARANCE_KINDS.length *
        RATING_STATE_KINDS.length,
    );
    expect(
      new Set(PRESENTATION_COMBINATIONS.map((combination) => combinationLabel(combination)))
        .size,
    ).toBe(PRESENTATION_COMBINATIONS.length);
  });

  it('returns exactly one of the four kinds, and the one the criteria name, in every combination', () => {
    fc.assert(
      fc.property(combinationIngredientsArb, (ingredients) => {
        for (const combination of PRESENTATION_COMBINATIONS) {
          const { member, leaderboard } = buildCombinationCase(
            combination,
            ingredients,
          );

          expectDistinctIdentities(leaderboard);

          const presentation = selectRatingPresentation(member, leaderboard);

          // player-stats 17.1: one tag out of four, carrying only that tag's keys.
          expectExactlyOnePresentation(presentation);
          expect(presentation.kind, combinationLabel(combination)).toBe(
            expectedKindFor(combination),
          );

          if (presentation.kind === 'rating') {
            // 8.1: the number reported is this row's own entry value, formatted.
            expect(presentation.value, combinationLabel(combination)).toBe(
              formatDisplayRating(NAMED_ENTRY_VALUES[combination.value]),
            );
          }
        }
      }),
      { numRuns: 120 },
    );
  });

  it('returns no numeric value for a zero-appearance or provisional row, in every combination', () => {
    const bandCombinations = PRESENTATION_COMBINATIONS.filter(
      (combination) =>
        combination.shape !== 'absent' &&
        (combination.appearances === 'zero' ||
          combination.ratingState === 'Provisional'),
    );

    expect(bandCombinations.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(combinationIngredientsArb, (ingredients) => {
        for (const combination of bandCombinations) {
          const { member, leaderboard } = buildCombinationCase(
            combination,
            ingredients,
          );

          const presentation = selectRatingPresentation(member, leaderboard);

          // player-stats 17.2: these two rows are bands. Not "a band unless the
          // leaderboard happens to carry a usable value" — the table includes the
          // cells where it does, and they are bands there too.
          expect(presentation.kind, combinationLabel(combination)).toBe(
            combination.appearances === 'zero' ? 'never-played' : 'provisional',
          );
          expectNoNumericValue(presentation);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('separates the zero-appearance row from the provisional row in every rating state', () => {
    fc.assert(
      fc.property(
        combinationIngredientsArb,
        fc.constantFrom(...LEADERBOARD_SHAPES),
        fc.constantFrom(...NAMED_ENTRY_VALUE_KINDS),
        (ingredients, shape, value) => {
          for (const ratingState of RATING_STATE_KINDS) {
            const neverPlayed = buildCombinationCase(
              { shape, value, appearances: 'zero', ratingState },
              ingredients,
            );
            const played = buildCombinationCase(
              { shape, value, appearances: 'positive', ratingState: 'Provisional' },
              ingredients,
            );

            const neverPlayedPresentation = selectRatingPresentation(
              neverPlayed.member,
              neverPlayed.leaderboard,
            );
            const playedPresentation = selectRatingPresentation(
              played.member,
              played.leaderboard,
            );

            // player-stats 17.2 is the whole point of the amendment: these two
            // situations used to collapse onto one band. They may only coincide
            // when no leaderboard was obtained at all, where neither row knows
            // anything (Requirement 7.10).
            if (shape === 'absent') {
              expect(neverPlayedPresentation).toEqual({ kind: 'unavailable' });
              expect(playedPresentation).toEqual({ kind: 'unavailable' });
            } else {
              expect(neverPlayedPresentation).toEqual({ kind: 'never-played' });
              expect(playedPresentation).toEqual({ kind: 'provisional' });
              expect(neverPlayedPresentation.kind).not.toBe(
                playedPresentation.kind,
              );
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
