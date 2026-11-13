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
 * cover, and running well above the 100-iteration floor.
 *
 * A Player_Row says exactly **one** of three things about a rating: a
 * Display_Rating, that the player has played no matches, or that the rating
 * could not be obtained. The type already stops a value carrying two of them, so
 * what these tests are for is the part the type cannot state: that the *branch
 * chosen* is the right one for every shape of input the screen can hand over.
 *
 * The claims:
 *
 * 1. **Exactly one presentation**, and the one an independent oracle names, for
 *    every generated member and leaderboard.
 * 2. **Every rated player shows a number.** A member whose rating is still
 *    settling gets the same `rating` presentation as anyone else, with the value
 *    the leaderboard carried for them and `settling: true`; the Rating_State
 *    never changes the value.
 * 3. **Never played and unavailable are exact**: a zero Appearance_Count wins
 *    over every rating branch, and a missing or unusable entry is unavailable.
 * 4. **Three member fields are read, and no others**, so no presentation can
 *    vary with role, membership state, guest flag or name.
 * 5. **The selection is pure and total.**
 */

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

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

interface RatingFieldArbs {
  readonly appearances: fc.Arbitrary<number>;
  readonly ratingState: fc.Arbitrary<RatingState | null>;
}

/** Any Appearance_Count and any Rating_State: the whole admitted space. */
const ANY_RATING_FIELDS: RatingFieldArbs = {
  appearances: fc.nat({ max: 200 }),
  ratingState: ratingStateArb,
};

/** A member who has played, in any Rating_State. */
const PLAYED_RATING_FIELDS: RatingFieldArbs = {
  appearances: fc.integer({ min: 1, max: 200 }),
  ratingState: ratingStateArb,
};

/** A member who has played and whose rating is still settling. */
const SETTLING_RATING_FIELDS: RatingFieldArbs = {
  appearances: fc.integer({ min: 1, max: 200 }),
  ratingState: fc.constant('Provisional' as const),
};

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

/** A member who has played, so the rating branches are open to them. */
const playedMemberArb: fc.Arbitrary<SquadMember> = fc
  .uuid()
  .chain((membershipId) => memberWithIdentity(membershipId, PLAYED_RATING_FIELDS));

/** A member who has played and whose rating is still settling. */
const settlingMemberArb: fc.Arbitrary<SquadMember> = fc
  .uuid()
  .chain((membershipId) => memberWithIdentity(membershipId, SETTLING_RATING_FIELDS));

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

/** The three values that carry no rating at all. */
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

/** Entries for other memberships, with distinct identities. */
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

function leaderboardWithoutMatch(
  membershipId: string,
): fc.Arbitrary<DisplayRatingLeaderboard> {
  return otherEntriesArb(membershipId).map((entries) => ({ entries }));
}

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

/* -------------------------------------------------------------------------- */
/* The oracle and the shape checks                                            */
/* -------------------------------------------------------------------------- */

/** The presentation the rules name, written independently of the module. */
function oraclePresentation(
  member: SquadMember,
  leaderboard: DisplayRatingLeaderboard | null,
): RatingPresentation {
  if (leaderboard === null) {
    return { kind: 'unavailable' };
  }

  if (member.appearances === 0) {
    return { kind: 'never-played' };
  }

  const matching = leaderboard.entries.filter(
    (entry) => entry.membershipId === member.membershipId,
  );

  if (matching.length !== 1) {
    return { kind: 'unavailable' };
  }

  const value = matching[0].value;

  if (
    Number.isNaN(value) ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY
  ) {
    return { kind: 'unavailable' };
  }

  return {
    kind: 'rating',
    value: formatDisplayRating(value),
    settling: member.ratingState === 'Provisional',
  };
}

function expectDistinctIdentities(leaderboard: DisplayRatingLeaderboard | null): void {
  if (leaderboard === null) {
    return;
  }

  const identities = leaderboard.entries.map((entry) => entry.membershipId);

  expect(new Set(identities).size).toBe(identities.length);
}

function expectExactlyOnePresentation(presentation: RatingPresentation): void {
  expect(['rating', 'never-played', 'unavailable']).toContain(presentation.kind);

  if (presentation.kind === 'rating') {
    expect(Object.keys(presentation).sort()).toEqual(['kind', 'settling', 'value']);
    expect(typeof presentation.value).toBe('number');
    expect(Number.isFinite(presentation.value)).toBe(true);
    expect(typeof presentation.settling).toBe('boolean');
  } else {
    expect(Object.keys(presentation)).toEqual(['kind']);
  }
}

/** A deep structural snapshot, for the no-mutation claims. */
function snapshot(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === 'number' && !Number.isFinite(entry) ? String(entry) : entry,
  );
}

/* -------------------------------------------------------------------------- */
/* Exactly one presentation                                                   */
/* -------------------------------------------------------------------------- */

describe('selectRatingPresentation — exactly one presentation for every input', () => {
  it('agrees with the rules on every generated input', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
        expectDistinctIdentities(leaderboard);

        expect(selectRatingPresentation(member, leaderboard)).toEqual(
          oraclePresentation(member, leaderboard),
        );
      }),
      { numRuns: 600 },
    );
  });

  it('returns exactly one of the three presentations, carrying only that tag payload', () => {
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
        playedMemberArb,
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
          expect(presentation.kind).toBe(
            includeMember && size > 0 ? 'rating' : 'unavailable',
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The branches are exact                                                     */
/* -------------------------------------------------------------------------- */

describe('selectRatingPresentation — the branches are exact', () => {
  it('yields Rating_Unavailable whenever no leaderboard was obtained', () => {
    fc.assert(
      fc.property(memberArb, (member) => {
        expect(selectRatingPresentation(member, null)).toEqual({ kind: 'unavailable' });
      }),
      { numRuns: 300 },
    );
  });

  it('yields Never_Played for a zero Appearance_Count, whatever the rating says', () => {
    fc.assert(
      fc.property(
        memberArb.chain((member) =>
          fc.record({
            member: fc.constant({ ...member, appearances: 0 }),
            leaderboard: fc.oneof(
              leaderboardWithoutMatch(member.membershipId),
              leaderboardWithMatch(member.membershipId, anyValueArb).map(
                ({ leaderboard }) => leaderboard,
              ),
            ),
          }),
        ),
        ({ member, leaderboard }) => {
          expect(selectRatingPresentation(member, leaderboard)).toEqual({
            kind: 'never-played',
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it('yields Rating_Unavailable for a played row the leaderboard does not name', () => {
    fc.assert(
      fc.property(
        playedMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            leaderboard: leaderboardWithoutMatch(member.membershipId),
          }),
        ),
        ({ member, leaderboard }) => {
          expectDistinctIdentities(leaderboard);

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
        playedMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, nonFiniteValueArb),
          }),
        ),
        ({ member, match }) => {
          expectDistinctIdentities(match.leaderboard);

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
        playedMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, finiteValueArb),
          }),
        ),
        ({ member, match }) => {
          expectDistinctIdentities(match.leaderboard);

          expect(selectRatingPresentation(member, match.leaderboard)).toEqual({
            kind: 'rating',
            value: formatDisplayRating(match.matching.value),
            settling: member.ratingState === 'Provisional',
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  it('takes the Display_Rating branch for minus zero and for very large magnitudes', () => {
    fc.assert(
      fc.property(
        playedMemberArb,
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

          expect(presentation).toEqual({
            kind: 'rating',
            value: formatDisplayRating(value),
            settling: member.ratingState === 'Provisional',
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

          expect(selectRatingPresentation(member, disturbed)).toEqual(
            selectRatingPresentation(member, match.leaderboard),
          );
        },
      ),
      { numRuns: 400 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* A settling rating is a rating                                              */
/* -------------------------------------------------------------------------- */

describe('selectRatingPresentation — a settling rating shows its number like any other', () => {
  it('gives a settling player the number the leaderboard carries for them, marked as settling', () => {
    fc.assert(
      fc.property(
        settlingMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, finiteValueArb),
          }),
        ),
        ({ member, match }) => {
          expect(selectRatingPresentation(member, match.leaderboard)).toEqual({
            kind: 'rating',
            value: formatDisplayRating(match.matching.value),
            settling: true,
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('never lets the Rating_State change the value, only the settling flag', () => {
    fc.assert(
      fc.property(
        playedMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, finiteValueArb),
          }),
        ),
        ({ member, match }) => {
          const presentations = (['Provisional', 'Established', null] as const).map(
            (ratingState) =>
              selectRatingPresentation({ ...member, ratingState }, match.leaderboard),
          );

          expect(presentations.map((presentation) => presentation.kind)).toEqual([
            'rating',
            'rating',
            'rating',
          ]);
          expect(
            presentations.map((presentation) =>
              presentation.kind === 'rating' ? presentation.value : null,
            ),
          ).toEqual(Array(3).fill(formatDisplayRating(match.matching.value)));
          expect(
            presentations.map((presentation) =>
              presentation.kind === 'rating' ? presentation.settling : null,
            ),
          ).toEqual([true, false, false]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('shows no number for a settling player the leaderboard does not name', () => {
    fc.assert(
      fc.property(
        settlingMemberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            leaderboard: leaderboardWithoutMatch(member.membershipId),
          }),
        ),
        ({ member, leaderboard }) => {
          expect(selectRatingPresentation(member, leaderboard)).toEqual({
            kind: 'unavailable',
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Three member fields are read, and no others                                */
/* -------------------------------------------------------------------------- */

describe('selectRatingPresentation — three member fields are read, and no others', () => {
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

          expect(selectRatingPresentation(first, leaderboard)).toEqual(
            selectRatingPresentation(second, leaderboard),
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Pure and total                                                             */
/* -------------------------------------------------------------------------- */

describe('selectRatingPresentation — the selection is pure and total', () => {
  it('returns equal results for equal inputs', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
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

  it('reaches all three presentations, and both settling flags, from generated input', () => {
    const presentations = fc
      .sample(selectionCaseArb, { numRuns: 600, seed: 17 })
      .map(({ member, leaderboard }) => selectRatingPresentation(member, leaderboard));

    expect(new Set(presentations.map((presentation) => presentation.kind))).toEqual(
      new Set(['rating', 'never-played', 'unavailable']),
    );
    expect(
      new Set(
        presentations.flatMap((presentation) =>
          presentation.kind === 'rating' ? [presentation.settling] : [],
        ),
      ),
    ).toEqual(new Set([true, false]));
  });
});
