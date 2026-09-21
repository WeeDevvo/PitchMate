import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  formatDisplayRating,
  selectRatingPresentation,
  type RatingPresentation,
} from './ratingPresentation';
import type { MemberRole, MembershipStateValue } from './enumCodes';
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
 * Requirement 8.5 allows a Player_Row exactly **one** of three presentations, and
 * Requirement 20.7 asks for that "exactly one" to be a property over generated
 * input rather than a rendering convention. The type already stops a value
 * carrying a number *and* claiming to be provisional, so what these tests are for
 * is the part the type cannot state: that the *branch chosen* is the one the
 * acceptance criteria name, for every shape of input the screen can hand over.
 *
 * Four claims are made:
 *
 * - **Exactly one presentation, for every input.** Stated against an
 *   independently written oracle — the three branches read off Requirements 8.1,
 *   8.3, and 8.10 rather than derived from the module's own comparisons, and using
 *   explicit `NaN` / `±Infinity` tests rather than the `Number.isFinite` call the
 *   module makes, so an inverted guard cannot agree with both. Cross-checked
 *   structurally: exactly one of the three tag predicates holds, and the returned
 *   object carries exactly the keys that tag permits.
 * - **The three branches are exact at their boundaries.** An absent leaderboard is
 *   `unavailable` however the member is shaped (Requirement 7.10 routes the failed,
 *   timed-out, still-in-flight, and parser-rejected leaderboard here, including
 *   Requirement 8.11's duplicate-identity body). A leaderboard carrying no matching
 *   entry, and a matching entry whose value is not finite, are both `provisional`
 *   and carry no numeric value (Requirements 8.3, 8.10). Everything else is
 *   `rating`.
 * - **Only the membership identity of the member is read.** Requirement 8.12
 *   forbids the Provisional_Band from varying with Membership_State, Guest_Flag,
 *   Member_Role, or leaderboard size. Asserting equal results across those fields
 *   would leave a future branch free to read one of them and coincidentally agree,
 *   so the stronger form is asserted directly: a recording `Proxy` around the
 *   member shows that `membershipId` is the only property the function touches,
 *   and nothing at all is touched when the leaderboard is absent.
 * - **The selection is pure and total.** Equal inputs give equal results
 *   (Requirement 8.6), repeated and interleaved calls agree, nothing throws, and
 *   neither the member nor the leaderboard is mutated.
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
const roleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom(
  'owner' as const,
  'admin' as const,
  'member' as const,
  null,
);

/** Both Membership_States; a parsed Squad_Member always carries one. */
const stateArb: fc.Arbitrary<MembershipStateValue> = fc.constantFrom(
  'active' as const,
  'inactive' as const,
);

/** A display name, including the empty string and a case-varying family. */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.constantFrom('Dave', 'dave', 'DAVE', 'Former player', ''),
);

/** A Squad_Member with a generated identity, role, state, and Guest_Flag. */
function memberWithIdentity(membershipId: string): fc.Arbitrary<SquadMember> {
  return fc.record({
    membershipId: fc.constant(membershipId),
    displayName: displayNameArb,
    role: roleArb,
    state: stateArb,
    isGuest: fc.boolean(),
  });
}

const memberArb: fc.Arbitrary<SquadMember> = fc
  .uuid()
  .chain((membershipId) => memberWithIdentity(membershipId));

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

/** The three values Requirement 8.10 sends to the Provisional_Band. */
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
 * The three branches written straight out of the acceptance criteria rather than
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
 */
function oraclePresentation(
  member: SquadMember,
  leaderboard: DisplayRatingLeaderboard | null,
): RatingPresentation {
  // 7.10, 8.11: no usable leaderboard body reached the screen.
  if (leaderboard === null) {
    return { kind: 'unavailable' };
  }

  const matching = leaderboard.entries.filter(
    (entry) => entry.membershipId === member.membershipId,
  );

  // 8.3: no entry names this membership.
  if (matching.length !== 1) {
    return { kind: 'provisional' };
  }

  const value = matching[0].value;

  // 8.10: a value that is not a finite number says nothing about the player.
  if (
    Number.isNaN(value) ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY
  ) {
    return { kind: 'provisional' };
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
 * The structural half of "exactly one presentation": one tag out of three, and
 * exactly the keys that tag permits — so a `provisional` result cannot smuggle a
 * number alongside it, and a `rating` result cannot omit one.
 */
function expectExactlyOnePresentation(presentation: RatingPresentation): void {
  const isRating = presentation.kind === 'rating';
  const isProvisional = presentation.kind === 'provisional';
  const isUnavailable = presentation.kind === 'unavailable';

  expect([isRating, isProvisional, isUnavailable].filter(Boolean)).toHaveLength(1);

  if (presentation.kind === 'rating') {
    expect(Object.keys(presentation).sort()).toEqual(['kind', 'value']);
    expect(typeof presentation.value).toBe('number');
    expect(Number.isFinite(presentation.value)).toBe(true);
  } else {
    // 8.12, 8.13: the two absence presentations carry no payload at all, so
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
        memberArb,
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
            includeMember && size > 0 ? 'rating' : 'provisional',
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 19: Exactly one Rating_Presentation is selected for every input
// Validates: Requirements 8.3, 8.5, 8.6, 8.10
describe('selectRatingPresentation — the three branches are exact', () => {
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

  it('yields the Provisional_Band when the leaderboard carries no matching entry', () => {
    fc.assert(
      fc.property(
        memberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            leaderboard: leaderboardWithoutMatch(member.membershipId),
          }),
        ),
        ({ member, leaderboard }) => {
          expectDistinctIdentities(leaderboard);

          // 8.3: an absent entry is a Provisional_Band and no numeric value,
          // whether the leaderboard is empty or full of other people.
          expect(selectRatingPresentation(member, leaderboard)).toEqual({
            kind: 'provisional',
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('yields the Provisional_Band when the matching entry value is NaN or an infinity', () => {
    fc.assert(
      fc.property(
        memberArb.chain((member) =>
          fc.record({
            member: fc.constant(member),
            match: leaderboardWithMatch(member.membershipId, nonFiniteValueArb),
          }),
        ),
        ({ member, match }) => {
          expectDistinctIdentities(match.leaderboard);

          // 8.10: an unusable value collapses onto the same statement as an absent
          // entry — no settled rating — rather than becoming a fourth case.
          expect(selectRatingPresentation(member, match.leaderboard)).toEqual({
            kind: 'provisional',
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('yields a Display_Rating reporting the matching entry value when it is finite', () => {
    fc.assert(
      fc.property(
        memberArb.chain((member) =>
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
        memberArb,
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

// Feature: web-squads-screens, Property 19: the presentation reads only the membership identity
// Validates: Requirements 8.6, 8.12
describe('selectRatingPresentation — only the membership identity of the member is read', () => {
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

  it('touches no member property other than membershipId', () => {
    fc.assert(
      fc.property(selectionCaseArb, ({ member, leaderboard }) => {
        const { tracked, reads } = trackedMember(member);

        selectRatingPresentation(tracked, leaderboard);

        // 8.12: Membership_State, Guest_Flag, Member_Role, and Player_Display_Name
        // are never consulted, so the band cannot acquire a tell through a branch
        // added later.
        expect(reads.filter((property) => property !== 'membershipId')).toEqual([]);
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
          .uuid()
          .chain((membershipId) =>
            fc.record({
              first: memberWithIdentity(membershipId),
              second: memberWithIdentity(membershipId),
              leaderboard: fc.oneof(
                fc.constant(null),
                leaderboardWithoutMatch(membershipId),
                leaderboardWithMatch(membershipId, anyValueArb).map(
                  ({ leaderboard }) => leaderboard,
                ),
              ),
            }),
          ),
        ({ first, second, leaderboard }) => {
          expectDistinctIdentities(leaderboard);

          // Two members sharing one identity and differing in everything else are
          // presented identically — the observable form of Requirement 8.12.
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
        memberArb,
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
